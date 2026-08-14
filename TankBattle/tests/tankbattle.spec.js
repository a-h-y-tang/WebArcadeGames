const { test, expect } = require('@playwright/test');
const path = require('path');
const { pathToFileURL } = require('url');

const GAME_URL = pathToFileURL(path.resolve(__dirname, '../index.html')).href;

// Advance the simulation deterministically: `frames` calls to step(dt).
const advance = (page, frames, dt = 1 / 60) =>
    page.evaluate(([f, d]) => {
        for (let i = 0; i < f; i++) step(d);
    }, [frames, dt]);

// Chromium can acknowledge a synthetic key event before the page's listener has
// run, so every key press is confirmed against the game state before the
// simulation is advanced. Without this the specs race the real animation loop.
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

const hold = async (page, key) => {
    await page.keyboard.down(key);
    await page.waitForFunction(
        (want) => player.dir.x === want.x && player.dir.y === want.y,
        KEY_DIR[key]
    );
};

const release = async (page, key) => {
    await page.keyboard.up(key);
    await page.waitForFunction(() => player.dir.x === 0 && player.dir.y === 0);
};

// Start a run with reinforcements switched off, so long simulations stay
// deterministic. Specs that are about enemy tanks leave spawning on or place
// tanks themselves with spawnEnemy().
const startQuiet = (page) =>
    page.evaluate(() => {
        startGame();
        spawnEnabled = false;
        enemies.length = 0;
    });

// Put a tank on the field ready to act (no spawn flash).
const placeEnemy = (page, type, col, row, facing) =>
    page.evaluate(([t, c, r, f]) => {
        const e = spawnEnemy(t, c, r);
        e.spawning = 0;
        if (f) {
            e.facing = { x: f.x, y: f.y };
            e.dir = { x: 0, y: 0 };
        }
        return e;
    }, [type, col, row, facing || null]);

test.describe('Tank Battle', () => {
    test.beforeEach(async ({ page }) => {
        await page.goto(GAME_URL);
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

        test('canvas is 560x504', async ({ page }) => {
            const canvas = page.locator('#canvas');
            await expect(canvas).toHaveAttribute('width', '560');
            await expect(canvas).toHaveAttribute('height', '504');
        });

        test('state is idle before starting', async ({ page }) => {
            expect(await page.evaluate(() => state)).toBe('idle');
        });

        test('HUD shows starting score, level and lives', async ({ page }) => {
            await expect(page.locator('#score')).toHaveText('0');
            await expect(page.locator('#level')).toHaveText('1');
            await expect(page.locator('#lives')).toHaveText('3');
        });

        test('HUD shows the whole first wave as remaining', async ({ page }) => {
            const planned = await page.evaluate(() => enemyPlanForLevel(1).length);
            await expect(page.locator('#enemies')).toHaveText(String(planned));
        });

        test('best score loads from localStorage', async ({ page }) => {
            await page.evaluate(() => window.localStorage.setItem('tankbattle-best', '7300'));
            await page.reload();
            await expect(page.locator('#best')).toHaveText('7300');
        });

        test('no tanks, bullets or power-ups before starting', async ({ page }) => {
            expect(await page.evaluate(() => enemies.length)).toBe(0);
            expect(await page.evaluate(() => bullets.length)).toBe(0);
            expect(await page.evaluate(() => powerups.length)).toBe(0);
        });

        test('the arena grid is 18 rows of 20 columns', async ({ page }) => {
            expect(await page.evaluate(() => grid.length)).toBe(ROWS);
            expect(await page.evaluate(() => ROWS)).toBe(18);
            expect(await page.evaluate(() => COLS)).toBe(20);
            const widths = await page.evaluate(() => grid.map((r) => r.length));
            expect(new Set(widths)).toEqual(new Set([20]));
        });

        test('the base sits intact at the bottom of the arena', async ({ page }) => {
            expect(await page.evaluate(() => base.alive)).toBe(true);
            const tiles = await page.evaluate(() => [
                tileAt(9, 16), tileAt(10, 16), tileAt(9, 17), tileAt(10, 17),
            ]);
            expect(tiles).toEqual(['E', 'E', 'E', 'E']);
        });

        test('the base is walled in with brick', async ({ page }) => {
            const walls = await page.evaluate(() => [
                tileAt(8, 15), tileAt(9, 15), tileAt(10, 15), tileAt(11, 15),
                tileAt(8, 16), tileAt(11, 16), tileAt(8, 17), tileAt(11, 17),
            ]);
            expect(walls).toEqual(Array(8).fill('#'));
        });

        test('the player tank waits on its spawn tile', async ({ page }) => {
            const pos = await page.evaluate(() => ({
                x: player.x, y: player.y, spawn: centerOf(PLAYER_SPAWN.col, PLAYER_SPAWN.row),
            }));
            expect(pos.x).toBeCloseTo(pos.spawn.x, 5);
            expect(pos.y).toBeCloseTo(pos.spawn.y, 5);
        });

        test('step() does nothing while idle', async ({ page }) => {
            const before = await page.evaluate(() => ({ x: player.x, y: player.y }));
            await page.evaluate(() => { player.dir = { x: 1, y: 0 }; });
            await advance(page, 60);
            const after = await page.evaluate(() => ({ x: player.x, y: player.y }));
            expect(after).toEqual(before);
        });
    });

    // -----------------------------------------------------------------------
    // Starting a run
    // -----------------------------------------------------------------------
    test.describe('starting', () => {
        test('Space starts the game', async ({ page }) => {
            await page.keyboard.press('Space');
            await expect.poll(() => page.evaluate(() => state)).toBe('playing');
        });

        test('Enter starts the game', async ({ page }) => {
            await page.keyboard.press('Enter');
            await expect.poll(() => page.evaluate(() => state)).toBe('playing');
        });

        test('the start button starts the game', async ({ page }) => {
            await page.locator('#btn-start').click();
            await expect.poll(() => page.evaluate(() => state)).toBe('playing');
        });

        test('overlay hides once running', async ({ page }) => {
            await startQuiet(page);
            await expect(page.locator('#overlay')).not.toHaveClass(/visible/);
        });

        test('reinforcements arrive over time', async ({ page }) => {
            await page.evaluate(() => startGame());
            await advance(page, 60 * 8);
            expect(await page.evaluate(() => enemies.length)).toBeGreaterThan(0);
        });

        test('tanks spawn at the top of the arena', async ({ page }) => {
            await page.evaluate(() => startGame());
            await advance(page, 60);
            const rows = await page.evaluate(() => enemies.map((e) => rowOf(e.y)));
            expect(rows.length).toBeGreaterThan(0);
            for (const r of rows) expect(r).toBeLessThan(2);
        });

        test('spawning stops at the concurrent tank limit', async ({ page }) => {
            await page.evaluate(() => { startGame(); player.invuln = 999; });
            const cap = await page.evaluate(() => maxOnFieldForLevel(1));
            for (let i = 0; i < 20; i++) {
                await advance(page, 60);
                expect(await page.evaluate(() => enemies.length)).toBeLessThanOrEqual(cap);
            }
        });

        test('a fresh tank flashes in before it can act', async ({ page }) => {
            await page.evaluate(() => { startGame(); spawnEnabled = false; enemies.length = 0; spawnEnemy('basic', 0, 0); });
            expect(await page.evaluate(() => enemies[0].spawning)).toBeGreaterThan(0);
            const before = await page.evaluate(() => ({ x: enemies[0].x, y: enemies[0].y }));
            await advance(page, 10);
            const after = await page.evaluate(() => ({ x: enemies[0].x, y: enemies[0].y }));
            expect(after).toEqual(before);
            expect(await page.evaluate(() => bullets.length)).toBe(0);
        });
    });

    // -----------------------------------------------------------------------
    // Driving the player tank
    // -----------------------------------------------------------------------
    test.describe('movement', () => {
        test.beforeEach(async ({ page }) => {
            await startQuiet(page);
            await page.evaluate(() => placePlayer(1, 10));
        });

        test('holding right drives the tank right', async ({ page }) => {
            const before = await page.evaluate(() => player.x);
            await hold(page, 'ArrowRight');
            await advance(page, 30);
            expect(await page.evaluate(() => player.x)).toBeGreaterThan(before + 20);
            await release(page, 'ArrowRight');
        });

        test('holding down drives the tank down', async ({ page }) => {
            const before = await page.evaluate(() => player.y);
            await hold(page, 'ArrowDown');
            await advance(page, 30);
            expect(await page.evaluate(() => player.y)).toBeGreaterThan(before + 20);
            await release(page, 'ArrowDown');
        });

        test('W A S D also drive the tank', async ({ page }) => {
            const before = await page.evaluate(() => player.y);
            await hold(page, 'w');
            await advance(page, 30);
            expect(await page.evaluate(() => player.y)).toBeLessThan(before - 20);
            await release(page, 'w');
        });

        test('the tank stops when the key is released', async ({ page }) => {
            await hold(page, 'ArrowRight');
            await advance(page, 10);
            await release(page, 'ArrowRight');
            const before = await page.evaluate(() => player.x);
            await advance(page, 30);
            expect(await page.evaluate(() => player.x)).toBeCloseTo(before, 5);
        });

        test('driving sets the facing direction', async ({ page }) => {
            await hold(page, 'ArrowUp');
            await advance(page, 5);
            expect(await page.evaluate(() => player.facing)).toEqual({ x: 0, y: -1 });
            await release(page, 'ArrowUp');
            expect(await page.evaluate(() => player.facing)).toEqual({ x: 0, y: -1 });
        });

        test('the tank is stopped by the arena wall', async ({ page }) => {
            await hold(page, 'ArrowLeft');
            await advance(page, 120);
            expect(await page.evaluate(() => player.x)).toBeGreaterThanOrEqual(12);
            await release(page, 'ArrowLeft');
        });

        test('brick blocks the tank', async ({ page }) => {
            await page.evaluate(() => setTile(3, 10, '#'));
            await hold(page, 'ArrowRight');
            await advance(page, 120);
            expect(await page.evaluate(() => player.x)).toBeLessThan(3 * 28);
            await release(page, 'ArrowRight');
        });

        test('steel blocks the tank', async ({ page }) => {
            await page.evaluate(() => setTile(3, 10, '@'));
            await hold(page, 'ArrowRight');
            await advance(page, 120);
            expect(await page.evaluate(() => player.x)).toBeLessThan(3 * 28);
            await release(page, 'ArrowRight');
        });

        test('water blocks the tank', async ({ page }) => {
            await page.evaluate(() => setTile(3, 10, '~'));
            await hold(page, 'ArrowRight');
            await advance(page, 120);
            expect(await page.evaluate(() => player.x)).toBeLessThan(3 * 28);
            await release(page, 'ArrowRight');
        });

        test('the base blocks the tank', async ({ page }) => {
            await page.evaluate(() => {
                placePlayer(9, 13);
                setTile(9, 15, '.');
            });
            await hold(page, 'ArrowDown');
            await advance(page, 180);
            expect(await page.evaluate(() => player.y)).toBeLessThan(16 * 28);
            await release(page, 'ArrowDown');
        });

        test('another tank blocks the way', async ({ page }) => {
            await placeEnemy(page, 'basic', 4, 10);
            await page.evaluate(() => { enemies[0].dir = { x: 0, y: 0 }; enemies[0].frozen = true; });
            await hold(page, 'ArrowRight');
            await advance(page, 120);
            expect(await page.evaluate(() => player.x)).toBeLessThan(4 * 28);
            await release(page, 'ArrowRight');
        });

        test('turning snaps the tank back into the lane', async ({ page }) => {
            const target = await page.evaluate(() => {
                player.y += 7;
                return centerOf(1, 10).y;
            });
            await hold(page, 'ArrowRight');
            await advance(page, 30);
            expect(await page.evaluate(() => player.y)).toBeCloseTo(target, 1);
            await release(page, 'ArrowRight');
        });
    });

    // -----------------------------------------------------------------------
    // Shooting
    // -----------------------------------------------------------------------
    test.describe('shooting', () => {
        test.beforeEach(async ({ page }) => {
            await startQuiet(page);
            await page.evaluate(() => {
                placePlayer(1, 10);
                player.facing = { x: 1, y: 0 };
            });
        });

        test('Space fires a shell', async ({ page }) => {
            await page.keyboard.press('Space');
            await expect.poll(() => page.evaluate(() => bullets.length)).toBe(1);
        });

        test('a shell travels in the direction the tank faces', async ({ page }) => {
            await page.evaluate(() => fire());
            const x0 = await page.evaluate(() => bullets[0].x);
            await advance(page, 6);
            const b = await page.evaluate(() => ({ x: bullets[0].x, y: bullets[0].y }));
            expect(b.x).toBeGreaterThan(x0);
            expect(b.y).toBeCloseTo(await page.evaluate(() => player.y), 5);
        });

        test('only one player shell is in the air at a time', async ({ page }) => {
            await page.evaluate(() => { fire(); fire(); fire(); });
            expect(await page.evaluate(() => bullets.length)).toBe(1);
        });

        test('the tank can fire again once its shell is gone', async ({ page }) => {
            await page.evaluate(() => fire());
            await advance(page, 240);
            expect(await page.evaluate(() => bullets.length)).toBe(0);
            await page.evaluate(() => fire());
            expect(await page.evaluate(() => bullets.length)).toBe(1);
        });

        test('a shell knocks out brick', async ({ page }) => {
            await page.evaluate(() => { setTile(4, 10, '#'); fire(); });
            await advance(page, 60);
            expect(await page.evaluate(() => tileAt(4, 10))).toBe('.');
            expect(await page.evaluate(() => bullets.length)).toBe(0);
        });

        test('a shell bursts against steel', async ({ page }) => {
            await page.evaluate(() => { setTile(4, 10, '@'); fire(); });
            await advance(page, 60);
            expect(await page.evaluate(() => tileAt(4, 10))).toBe('@');
            expect(await page.evaluate(() => bullets.length)).toBe(0);
        });

        test('a shell flies over water', async ({ page }) => {
            await page.evaluate(() => { setTile(4, 10, '~'); fire(); });
            await advance(page, 20);
            const b = await page.evaluate(() => bullets.map((s) => s.x));
            expect(b.length).toBe(1);
            expect(b[0]).toBeGreaterThan(5 * 28);
        });

        test('a shell that leaves the arena is removed', async ({ page }) => {
            await page.evaluate(() => {
                for (let c = 2; c < COLS; c++) setTile(c, 10, '.');
                fire();
            });
            await advance(page, 240);
            expect(await page.evaluate(() => bullets.length)).toBe(0);
        });

        test('an upgraded shell punches through steel', async ({ page }) => {
            await page.evaluate(() => {
                player.star = true;
                setTile(4, 10, '@');
                fire();
            });
            await advance(page, 60);
            expect(await page.evaluate(() => tileAt(4, 10))).toBe('.');
        });

        test('opposing shells cancel each other out', async ({ page }) => {
            await page.evaluate(() => {
                for (let c = 2; c < 10; c++) setTile(c, 10, '.');
            });
            await placeEnemy(page, 'basic', 8, 10, { x: -1, y: 0 });
            await page.evaluate(() => { fire(); fireTank(enemies[0]); });
            expect(await page.evaluate(() => bullets.length)).toBe(2);
            await advance(page, 60);
            expect(await page.evaluate(() => bullets.length)).toBe(0);
            expect(await page.evaluate(() => enemies.length)).toBe(1);
            expect(await page.evaluate(() => lives)).toBe(3);
        });
    });

    // -----------------------------------------------------------------------
    // Enemy tanks
    // -----------------------------------------------------------------------
    test.describe('enemy tanks', () => {
        test.beforeEach(async ({ page }) => {
            await startQuiet(page);
            await page.evaluate(() => { setSeed(12345); placePlayer(1, 10); });
        });

        test('a tank drives once it has flashed in', async ({ page }) => {
            await placeEnemy(page, 'basic', 9, 0);
            const before = await page.evaluate(() => ({ x: enemies[0].x, y: enemies[0].y }));
            await advance(page, 120);
            const after = await page.evaluate(() => ({ x: enemies[0].x, y: enemies[0].y }));
            expect(after.x !== before.x || after.y !== before.y).toBe(true);
        });

        test('a shell destroys a tank and scores points', async ({ page }) => {
            await page.evaluate(() => {
                for (let c = 2; c < 8; c++) setTile(c, 10, '.');
                player.facing = { x: 1, y: 0 };
            });
            await placeEnemy(page, 'basic', 6, 10, { x: 1, y: 0 });
            await page.evaluate(() => { enemies[0].frozen = true; fire(); });
            await advance(page, 60);
            expect(await page.evaluate(() => enemies.length)).toBe(0);
            expect(await page.evaluate(() => score)).toBe(100);
            expect(await page.evaluate(() => kills)).toBe(1);
        });

        test('an armour tank needs two hits', async ({ page }) => {
            await page.evaluate(() => {
                for (let c = 2; c < 8; c++) setTile(c, 10, '.');
                player.facing = { x: 1, y: 0 };
            });
            await placeEnemy(page, 'armor', 6, 10, { x: 1, y: 0 });
            await page.evaluate(() => { enemies[0].frozen = true; fire(); });
            await advance(page, 60);
            expect(await page.evaluate(() => enemies.length)).toBe(1);
            expect(await page.evaluate(() => enemies[0].hp)).toBe(1);
            await page.evaluate(() => fire());
            await advance(page, 60);
            expect(await page.evaluate(() => enemies.length)).toBe(0);
        });

        test('a fast tank outruns a basic tank', async ({ page }) => {
            const speeds = await page.evaluate(() => {
                const a = spawnEnemy('basic', 0, 0);
                const b = spawnEnemy('fast', 19, 0);
                return { basic: a.speed, fast: b.speed };
            });
            expect(speeds.fast).toBeGreaterThan(speeds.basic);
        });

        test('the HUD counts the tanks still to beat', async ({ page }) => {
            const shown = await page.evaluate(() => {
                enemiesToSpawn = 5;
                enemies.length = 0;
                spawnEnemy('basic', 0, 0);
                updateHud();
                return document.getElementById('enemies').textContent;
            });
            expect(shown).toBe('6');
        });

        test('an enemy shell costs a life', async ({ page }) => {
            await page.evaluate(() => {
                for (let c = 2; c < 10; c++) setTile(c, 10, '.');
                player.invuln = 0;
            });
            await placeEnemy(page, 'basic', 8, 10, { x: -1, y: 0 });
            await page.evaluate(() => fireTank(enemies[0]));
            await advance(page, 60);
            expect(await page.evaluate(() => lives)).toBe(2);
            expect(await page.evaluate(() => player.alive)).toBe(false);
        });

        test('the player tank comes back at its spawn tile', async ({ page }) => {
            await page.evaluate(() => {
                player.invuln = 0;
                killPlayer();
            });
            await advance(page, 180);
            const pos = await page.evaluate(() => ({
                x: player.x, y: player.y, alive: player.alive, invuln: player.invuln,
                spawn: centerOf(PLAYER_SPAWN.col, PLAYER_SPAWN.row),
            }));
            expect(pos.alive).toBe(true);
            expect(pos.x).toBeCloseTo(pos.spawn.x, 5);
            expect(pos.y).toBeCloseTo(pos.spawn.y, 5);
            expect(pos.invuln).toBeGreaterThan(0);
        });

        test('a shielded tank shrugs off a shell', async ({ page }) => {
            await page.evaluate(() => {
                for (let c = 2; c < 10; c++) setTile(c, 10, '.');
                player.invuln = 5;
            });
            await placeEnemy(page, 'basic', 8, 10, { x: -1, y: 0 });
            await page.evaluate(() => fireTank(enemies[0]));
            await advance(page, 60);
            expect(await page.evaluate(() => lives)).toBe(3);
            expect(await page.evaluate(() => player.alive)).toBe(true);
        });

        test('an enemy shell does not hurt another enemy', async ({ page }) => {
            await page.evaluate(() => {
                for (let c = 2; c < 12; c++) setTile(c, 10, '.');
            });
            await placeEnemy(page, 'basic', 10, 10, { x: -1, y: 0 });
            await placeEnemy(page, 'basic', 6, 10, { x: -1, y: 0 });
            await page.evaluate(() => {
                enemies.forEach((e) => { e.frozen = true; });
                fireTank(enemies[0]);
            });
            await advance(page, 30);
            expect(await page.evaluate(() => enemies.length)).toBe(2);
        });

        test('a tank shoots when it lines up with the player', async ({ page }) => {
            await page.evaluate(() => { placePlayer(9, 10); });
            await placeEnemy(page, 'basic', 9, 2, { x: 0, y: 1 });
            await page.evaluate(() => { enemies[0].frozen = true; enemies[0].shootTimer = 0; step(1 / 60); });
            expect(await page.evaluate(() => bullets.filter((b) => b.side === 'enemy').length)).toBeGreaterThan(0);
        });

        test('losing the last life ends the game', async ({ page }) => {
            await page.evaluate(() => {
                lives = 1;
                player.invuln = 0;
                killPlayer();
            });
            expect(await page.evaluate(() => state)).toBe('gameover');
            expect(await page.evaluate(() => overReason)).toBe('lives');
            await expect(page.locator('#overlay')).toHaveClass(/visible/);
        });

        test('a destroyed tank loses its upgraded shell', async ({ page }) => {
            await page.evaluate(() => {
                player.star = true;
                player.invuln = 0;
                killPlayer();
            });
            await advance(page, 180);
            expect(await page.evaluate(() => player.star)).toBe(false);
        });
    });

    // -----------------------------------------------------------------------
    // The base
    // -----------------------------------------------------------------------
    test.describe('the base', () => {
        test.beforeEach(async ({ page }) => {
            await startQuiet(page);
            await page.evaluate(() => setTile(9, 15, '.'));
        });

        test('an enemy shell destroys the base and ends the game', async ({ page }) => {
            await placeEnemy(page, 'basic', 9, 13, { x: 0, y: 1 });
            await page.evaluate(() => fireTank(enemies[0]));
            await advance(page, 60);
            expect(await page.evaluate(() => base.alive)).toBe(false);
            expect(await page.evaluate(() => state)).toBe('gameover');
            expect(await page.evaluate(() => overReason)).toBe('base');
        });

        test('friendly fire also destroys the base', async ({ page }) => {
            await page.evaluate(() => {
                placePlayer(9, 13);
                player.facing = { x: 0, y: 1 };
                fire();
            });
            await advance(page, 60);
            expect(await page.evaluate(() => base.alive)).toBe(false);
            expect(await page.evaluate(() => state)).toBe('gameover');
        });

        test('the overlay explains a lost base', async ({ page }) => {
            await placeEnemy(page, 'basic', 9, 13, { x: 0, y: 1 });
            await page.evaluate(() => fireTank(enemies[0]));
            await advance(page, 60);
            await expect(page.locator('#overlay-title')).toContainText(/base/i);
        });
    });

    // -----------------------------------------------------------------------
    // Power-ups
    // -----------------------------------------------------------------------
    test.describe('power-ups', () => {
        test.beforeEach(async ({ page }) => {
            await startQuiet(page);
            await page.evaluate(() => { setSeed(999); placePlayer(1, 10); });
        });

        test('every fourth kill drops a power-up', async ({ page }) => {
            const counts = await page.evaluate(() => {
                const seen = [];
                for (let i = 0; i < 4; i++) {
                    destroyEnemy(spawnEnemy('basic', 0, 0));
                    seen.push(powerups.length);
                }
                return seen;
            });
            expect(counts).toEqual([0, 0, 0, 1]);
        });

        test('power-ups cycle shield, star, extra life', async ({ page }) => {
            const types = await page.evaluate(() => {
                const seen = [];
                for (let i = 0; i < 12; i++) {
                    destroyEnemy(spawnEnemy('basic', 0, 0));
                    if (powerups.length > seen.length) seen.push(powerups[powerups.length - 1].type);
                }
                return seen;
            });
            expect(types).toEqual(['shield', 'star', 'life']);
        });

        test('driving over a power-up collects it and scores', async ({ page }) => {
            await page.evaluate(() => { spawnPowerup('life', 1, 10); });
            await advance(page, 2);
            expect(await page.evaluate(() => powerups.length)).toBe(0);
            expect(await page.evaluate(() => score)).toBe(200);
        });

        test('a shield makes the tank invulnerable', async ({ page }) => {
            await page.evaluate(() => { player.invuln = 0; spawnPowerup('shield', 1, 10); });
            await advance(page, 2);
            expect(await page.evaluate(() => player.invuln)).toBeGreaterThan(5);
        });

        test('a star upgrades the shell', async ({ page }) => {
            await page.evaluate(() => { player.star = false; spawnPowerup('star', 1, 10); });
            await advance(page, 2);
            expect(await page.evaluate(() => player.star)).toBe(true);
        });

        test('an extra life is added to the count', async ({ page }) => {
            await page.evaluate(() => spawnPowerup('life', 1, 10));
            await advance(page, 2);
            expect(await page.evaluate(() => lives)).toBe(4);
        });

        test('an uncollected power-up fades away', async ({ page }) => {
            await page.evaluate(() => spawnPowerup('shield', 18, 1));
            expect(await page.evaluate(() => powerups.length)).toBe(1);
            await advance(page, 60 * 20);
            expect(await page.evaluate(() => powerups.length)).toBe(0);
        });
    });

    // -----------------------------------------------------------------------
    // Levels
    // -----------------------------------------------------------------------
    test.describe('levels', () => {
        test.beforeEach(async ({ page }) => {
            await startQuiet(page);
            await page.evaluate(() => { enemiesToSpawn = 0; enemies.length = 0; });
        });

        test('beating every tank clears the level', async ({ page }) => {
            await advance(page, 1);
            expect(await page.evaluate(() => state)).toBe('levelclear');
        });

        test('clearing a level pays a bonus', async ({ page }) => {
            await advance(page, 1);
            expect(await page.evaluate(() => score)).toBeGreaterThan(0);
        });

        test('the next level starts after a short pause', async ({ page }) => {
            await advance(page, 60 * 4);
            expect(await page.evaluate(() => state)).toBe('playing');
            expect(await page.evaluate(() => level)).toBe(2);
        });

        test('the next level loads a different arena', async ({ page }) => {
            await advance(page, 60 * 4);
            const same = await page.evaluate(() =>
                grid.map((r) => r.join('')).join('\n') === MAPS[1].join('\n'));
            expect(same).toBe(true);
        });

        test('score carries into the next level', async ({ page }) => {
            await page.evaluate(() => { score = 1000; });
            await advance(page, 60 * 4);
            expect(await page.evaluate(() => score)).toBeGreaterThan(1000);
        });

        test('the base and the player tank are restored', async ({ page }) => {
            await page.evaluate(() => { base.alive = true; placePlayer(3, 3); });
            await advance(page, 60 * 4);
            const pos = await page.evaluate(() => ({
                alive: base.alive, x: player.x, spawn: centerOf(PLAYER_SPAWN.col, PLAYER_SPAWN.row).x,
            }));
            expect(pos.alive).toBe(true);
            expect(pos.x).toBeCloseTo(pos.spawn, 5);
        });

        test('later levels field more tanks', async ({ page }) => {
            const [a, b] = await page.evaluate(() => [
                enemyPlanForLevel(1).length, enemyPlanForLevel(4).length,
            ]);
            expect(b).toBeGreaterThan(a);
        });

        test('later levels send tanks in faster', async ({ page }) => {
            const [a, b] = await page.evaluate(() => [
                spawnIntervalForLevel(1), spawnIntervalForLevel(6),
            ]);
            expect(b).toBeLessThan(a);
        });

        test('tanks never arrive faster than the floor', async ({ page }) => {
            const late = await page.evaluate(() => spawnIntervalForLevel(50));
            expect(late).toBeGreaterThan(0.5);
        });

        test('the arena cycles back around after the last map', async ({ page }) => {
            const cycles = await page.evaluate(() => {
                const n = MAPS.length;
                return mapForLevel(n + 1) === MAPS[0];
            });
            expect(cycles).toBe(true);
        });
    });

    // -----------------------------------------------------------------------
    // Pause
    // -----------------------------------------------------------------------
    test.describe('pause', () => {
        test.beforeEach(async ({ page }) => {
            await startQuiet(page);
            await page.evaluate(() => placePlayer(1, 10));
        });

        test('P pauses the game', async ({ page }) => {
            await page.keyboard.press('p');
            await expect.poll(() => page.evaluate(() => state)).toBe('paused');
        });

        test('P resumes the game', async ({ page }) => {
            await page.evaluate(() => togglePause());
            await page.evaluate(() => togglePause());
            expect(await page.evaluate(() => state)).toBe('playing');
        });

        test('nothing moves while paused', async ({ page }) => {
            await page.evaluate(() => {
                player.dir = { x: 1, y: 0 };
                togglePause();
            });
            const before = await page.evaluate(() => player.x);
            await advance(page, 60);
            expect(await page.evaluate(() => player.x)).toBeCloseTo(before, 5);
        });

        test('the overlay shows while paused', async ({ page }) => {
            await page.evaluate(() => togglePause());
            await expect(page.locator('#overlay')).toHaveClass(/visible/);
            await expect(page.locator('#overlay-title')).toContainText(/pause/i);
        });
    });

    // -----------------------------------------------------------------------
    // Best score / restart
    // -----------------------------------------------------------------------
    test.describe('best score', () => {
        test('a new best is stored on game over', async ({ page }) => {
            await startQuiet(page);
            await page.evaluate(() => {
                score = 4200;
                lives = 1;
                player.invuln = 0;
                killPlayer();
            });
            expect(await page.evaluate(() => window.localStorage.getItem('tankbattle-best'))).toBe('4200');
            await expect(page.locator('#best')).toHaveText('4200');
        });

        test('a lower score does not replace the best', async ({ page }) => {
            await page.evaluate(() => window.localStorage.setItem('tankbattle-best', '9000'));
            await page.reload();
            await startQuiet(page);
            await page.evaluate(() => {
                score = 100;
                lives = 1;
                player.invuln = 0;
                killPlayer();
            });
            expect(await page.evaluate(() => window.localStorage.getItem('tankbattle-best'))).toBe('9000');
        });

        test('restarting after game over resets the run', async ({ page }) => {
            await startQuiet(page);
            await page.evaluate(() => {
                score = 500;
                level = 3;
                lives = 1;
                setTile(2, 5, '.');
                player.invuln = 0;
                killPlayer();
            });
            expect(await page.evaluate(() => state)).toBe('gameover');
            await startQuiet(page);
            const run = await page.evaluate(() => ({
                state, score, level, lives, tile: tileAt(2, 5), baseAlive: base.alive,
                bullets: bullets.length, powerups: powerups.length,
            }));
            expect(run).toEqual({
                state: 'playing', score: 0, level: 1, lives: 3, tile: '#',
                baseAlive: true, bullets: 0, powerups: 0,
            });
        });
    });

    // -----------------------------------------------------------------------
    // Rendering
    // -----------------------------------------------------------------------
    test.describe('rendering', () => {
        test('the canvas is painted', async ({ page }) => {
            await startQuiet(page);
            await advance(page, 30);
            const painted = await page.evaluate(() => {
                draw();
                const d = ctx.getImageData(0, 0, CANVAS_W, CANVAS_H).data;
                for (let i = 0; i < d.length; i += 4) {
                    if (d[i] > 20 || d[i + 1] > 20 || d[i + 2] > 20) return true;
                }
                return false;
            });
            expect(painted).toBe(true);
        });

        test('drawing works in every state without throwing', async ({ page }) => {
            const errors = [];
            page.on('pageerror', (e) => errors.push(e.message));
            await page.evaluate(() => {
                draw(); // idle
                startGame();
                spawnEnabled = false;
                setSeed(7);
                spawnEnemy('basic', 0, 0);
                spawnEnemy('fast', 9, 0);
                spawnEnemy('armor', 19, 0);
                spawnPowerup('star', 5, 5);
                player.star = true;
                fire();
                for (let i = 0; i < 120; i++) step(1 / 60);
                draw(); // playing
                togglePause();
                draw(); // paused
                togglePause();
                enemies.length = 0;
                enemiesToSpawn = 0;
                step(1 / 60);
                draw(); // level clear
                for (let i = 0; i < 200; i++) step(1 / 60);
                draw();
                base.alive = false;
                draw(); // wrecked base
                lives = 1;
                player.invuln = 0;
                killPlayer();
                draw(); // game over
                for (let i = 0; i < 60; i++) step(1 / 60);
                draw();
            });
            expect(errors).toEqual([]);
        });
    });
});
