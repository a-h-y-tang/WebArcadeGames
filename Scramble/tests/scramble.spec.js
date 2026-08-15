const { test, expect } = require('@playwright/test');
const path = require('path');
const { pathToFileURL } = require('url');

const GAME_URL = pathToFileURL(path.resolve(__dirname, '../index.html')).href;

// The design contract the specs pin down. The game exposes the same values as
// page globals; these copies let assertions read naturally in Node scope.
const CANVAS_W = 640;
const CANVAS_H = 400;
const MIN_GAP = 110;      // narrowest cave a level may generate
const OPENING_GAP = 150;  // the calm stretch the ship flies into
const FUEL_MAX = 100;
const MAX_BULLETS = 4;
const SHIP_MIN_SX = 40;   // ship's screen-x limits
const SHIP_MAX_SX = 420;
const TANK_POINTS = 150;
const ROCKET_POINTS = 80;
const CLEAR_BONUS = 500;

// Advance the simulation deterministically: `frames` calls to step(dt).
const advance = (page, frames, dt = 1 / 60) =>
    page.evaluate(([f, d]) => {
        for (let i = 0; i < f; i++) step(d);
    }, [frames, dt]);

// Step one frame at a time until `expr` (evaluated as a page-scope expression)
// becomes true, then stop. Timed transitions — the crash pause, the level-clear
// pause — are checked the instant they land rather than after a fixed number of
// frames, so the assertions never race the simulation past the moment of
// interest.
const advanceUntil = async (page, expr, maxFrames = 900, dt = 1 / 60) => {
    const frames = await page.evaluate(([src, max, d]) => {
        const done = new Function(`return (${src});`);
        for (let i = 0; i < max; i++) {
            if (done()) return i;
            step(d);
        }
        return -1;
    }, [expr, maxFrames, dt]);
    expect(frames, `condition never became true: ${expr}`).toBeGreaterThanOrEqual(0);
    return frames;
};

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

// Chromium can acknowledge a synthetic key event before the page listener has
// run, so every press is confirmed against the game state before simulating.
const hold = async (page, key) => {
    await page.keyboard.down(key);
    await page.waitForFunction(
        (want) => ship.dir.x === want.x && ship.dir.y === want.y,
        KEY_DIR[key]
    );
};

const release = async (page, key) => {
    await page.keyboard.up(key);
    await page.waitForFunction(() => ship.dir.x === 0 && ship.dir.y === 0);
};

// Start a run with the cave flattened and the hazards cleared, so long
// simulations are about the one behaviour under test. Specs about the cave
// itself, or about the stock of targets, start the game normally instead.
const startClear = (page) =>
    page.evaluate(() => {
        startGame();
        flattenTerrain();
        rockets.length = 0;
        tanks.length = 0;
    });

test.describe('Scramble', () => {
    test.beforeEach(async ({ page }) => {
        await page.goto(GAME_URL);
    });

    // -----------------------------------------------------------------------
    // Initial / idle state
    // -----------------------------------------------------------------------
    test.describe('initial state', () => {
        test('page title is Scramble', async ({ page }) => {
            await expect(page).toHaveTitle('Scramble');
        });

        test('start overlay is visible', async ({ page }) => {
            await expect(page.locator('#overlay')).toHaveClass(/visible/);
        });

        test('overlay prompts the player to start', async ({ page }) => {
            await expect(page.locator('#overlay-sub')).toContainText(/space|start/i);
        });

        test('canvas is 640x400', async ({ page }) => {
            const canvas = page.locator('#canvas');
            await expect(canvas).toHaveAttribute('width', String(CANVAS_W));
            await expect(canvas).toHaveAttribute('height', String(CANVAS_H));
        });

        test('state is idle before starting', async ({ page }) => {
            expect(await page.evaluate(() => state)).toBe('idle');
        });

        test('HUD shows starting score, level, lives and fuel', async ({ page }) => {
            await expect(page.locator('#score')).toHaveText('0');
            await expect(page.locator('#level')).toHaveText('1');
            await expect(page.locator('#lives')).toHaveText('3');
            await expect(page.locator('#fuel')).toHaveText(String(FUEL_MAX));
        });

        test('best score loads from localStorage', async ({ page }) => {
            await page.evaluate(() => window.localStorage.setItem('scramble-best', '7300'));
            await page.reload();
            await expect(page.locator('#best')).toHaveText('7300');
        });

        test('no shots are in flight before starting', async ({ page }) => {
            expect(await page.evaluate(() => bullets.length)).toBe(0);
            expect(await page.evaluate(() => bombs.length)).toBe(0);
        });

        test('the cave has not scrolled yet', async ({ page }) => {
            expect(await page.evaluate(() => scrollX)).toBe(0);
        });
    });

    // -----------------------------------------------------------------------
    // Terrain
    // -----------------------------------------------------------------------
    test.describe('cave terrain', () => {
        test('terrain spans the whole level plus a screen of run-out', async ({ page }) => {
            const ok = await page.evaluate(
                () => terrain.length * COL_W >= levelLength(level) + CANVAS_W
            );
            expect(ok).toBe(true);
        });

        test('every column leaves a flyable gap, however rough the level', async ({ page }) => {
            // Later caves aim at rougher profiles, so the clamp that keeps a
            // cave flyable only really bites at higher levels — check them all.
            const gaps = await page.evaluate(() => {
                const worst = [];
                for (let lvl = 1; lvl <= 8; lvl++) {
                    buildLevel(lvl);
                    worst.push(Math.min(...terrain.map((c) => c.ground - c.ceil)));
                }
                buildLevel(1);
                return worst;
            });
            expect(Math.min(...gaps)).toBeGreaterThanOrEqual(MIN_GAP);
        });

        test('ceiling and ground stay inside the canvas', async ({ page }) => {
            const ok = await page.evaluate(() =>
                terrain.every((c) => c.ceil >= 0 && c.ground <= CANVAS_H && c.ceil < c.ground)
            );
            expect(ok).toBe(true);
        });

        test('terrain is deterministic for a level', async ({ page }) => {
            const before = await page.evaluate(() => terrain.slice(0, 40).map((c) => c.ground));
            await page.reload();
            const after = await page.evaluate(() => terrain.slice(0, 40).map((c) => c.ground));
            expect(after).toEqual(before);
        });

        test('later levels build a different cave', async ({ page }) => {
            const one = await page.evaluate(() => terrain.slice(0, 60).map((c) => c.ground));
            const two = await page.evaluate(() => {
                buildLevel(2);
                return terrain.slice(0, 60).map((c) => c.ground);
            });
            expect(two).not.toEqual(one);
        });

        test('groundAt and ceilAt read the column under a world x', async ({ page }) => {
            const sample = await page.evaluate(() => ({
                ground: groundAt(5 * COL_W + 3),
                ceil: ceilAt(5 * COL_W + 3),
                col: { ground: terrain[5].ground, ceil: terrain[5].ceil },
            }));
            expect(sample.ground).toBe(sample.col.ground);
            expect(sample.ceil).toBe(sample.col.ceil);
        });

        test('the opening stretch is calm enough to fly into', async ({ page }) => {
            const gap = await page.evaluate(() =>
                Math.min(...terrain.slice(0, 12).map((c) => c.ground - c.ceil))
            );
            expect(gap).toBeGreaterThanOrEqual(OPENING_GAP);
        });
    });

    // -----------------------------------------------------------------------
    // Starting a run
    // -----------------------------------------------------------------------
    test.describe('starting', () => {
        test('Space starts the run and hides the overlay', async ({ page }) => {
            await page.keyboard.press('Space');
            expect(await page.evaluate(() => state)).toBe('running');
            await expect(page.locator('#overlay')).not.toHaveClass(/visible/);
        });

        test('the start button starts the run', async ({ page }) => {
            await page.locator('#btn-start').click();
            expect(await page.evaluate(() => state)).toBe('running');
        });

        test('a new run resets score, lives, level and fuel', async ({ page }) => {
            const s = await page.evaluate(() => {
                score = 4200;
                lives = 1;
                level = 3;
                fuel = 12;
                startGame();
                return { score, lives, level, fuel, scrollX };
            });
            expect(s).toEqual({ score: 0, lives: 3, level: 1, fuel: FUEL_MAX, scrollX: 0 });
        });

        test('the ship starts inside the cave', async ({ page }) => {
            const clear = await page.evaluate(() => {
                startGame();
                return ship.y > ceilAt(ship.x) && ship.y < groundAt(ship.x);
            });
            expect(clear).toBe(true);
        });
    });

    // -----------------------------------------------------------------------
    // Flying
    // -----------------------------------------------------------------------
    test.describe('flying', () => {
        test('the cave scrolls past while running', async ({ page }) => {
            await startClear(page);
            await advance(page, 60);
            expect(await page.evaluate(() => scrollX)).toBeGreaterThan(0);
        });

        test('the ship holds its screen position as the cave scrolls', async ({ page }) => {
            await startClear(page);
            const before = await page.evaluate(() => ship.x - scrollX);
            await advance(page, 60);
            const after = await page.evaluate(() => ship.x - scrollX);
            expect(Math.abs(after - before)).toBeLessThan(1);
        });

        test('ArrowUp climbs and ArrowDown dives', async ({ page }) => {
            await startClear(page);
            const start = await page.evaluate(() => ship.y);
            await hold(page, 'ArrowUp');
            await advance(page, 20);
            const up = await page.evaluate(() => ship.y);
            await release(page, 'ArrowUp');
            expect(up).toBeLessThan(start);

            await hold(page, 'ArrowDown');
            await advance(page, 40);
            const down = await page.evaluate(() => ship.y);
            await release(page, 'ArrowDown');
            expect(down).toBeGreaterThan(up);
        });

        test('ArrowRight speeds up and ArrowLeft holds back', async ({ page }) => {
            await startClear(page);
            await hold(page, 'ArrowRight');
            await advance(page, 20);
            const fast = await page.evaluate(() => ship.x - scrollX);
            await release(page, 'ArrowRight');

            await hold(page, 'ArrowLeft');
            await advance(page, 40);
            const slow = await page.evaluate(() => ship.x - scrollX);
            await release(page, 'ArrowLeft');
            expect(slow).toBeLessThan(fast);
        });

        test('WASD flies the ship too', async ({ page }) => {
            await startClear(page);
            const start = await page.evaluate(() => ship.y);
            await hold(page, 'w');
            await advance(page, 20);
            await release(page, 'w');
            expect(await page.evaluate(() => ship.y)).toBeLessThan(start);
        });

        test('the ship cannot be flown off the left or right of the screen', async ({ page }) => {
            await startClear(page);
            await hold(page, 'ArrowRight');
            await advance(page, 400);
            await release(page, 'ArrowRight');
            expect(await page.evaluate(() => ship.x - scrollX)).toBeLessThanOrEqual(SHIP_MAX_SX);

            await hold(page, 'ArrowLeft');
            await advance(page, 400);
            await release(page, 'ArrowLeft');
            expect(await page.evaluate(() => ship.x - scrollX)).toBeGreaterThanOrEqual(SHIP_MIN_SX);
        });

        test('holding no key leaves the ship level', async ({ page }) => {
            await startClear(page);
            const before = await page.evaluate(() => ship.y);
            await advance(page, 60);
            expect(await page.evaluate(() => ship.y)).toBeCloseTo(before, 5);
        });
    });

    // -----------------------------------------------------------------------
    // Weapons
    // -----------------------------------------------------------------------
    test.describe('weapons', () => {
        test('Space fires a laser from the nose of the ship', async ({ page }) => {
            await startClear(page);
            await page.keyboard.press('Space');
            const shot = await page.evaluate(() => ({
                count: bullets.length,
                ahead: bullets[0].x >= ship.x,
                offset: Math.abs(bullets[0].y - ship.y),
            }));
            expect(shot.count).toBe(1);
            expect(shot.ahead).toBe(true);
            expect(shot.offset).toBeLessThan(6);
        });

        test('lasers fly forward faster than the cave scrolls', async ({ page }) => {
            await startClear(page);
            await page.evaluate(() => fire());
            const before = await page.evaluate(() => bullets[0].x - scrollX);
            await advance(page, 10);
            const after = await page.evaluate(() => bullets[0].x - scrollX);
            expect(after).toBeGreaterThan(before);
        });

        test('lasers travel level with no drop', async ({ page }) => {
            await startClear(page);
            await page.evaluate(() => fire());
            const y0 = await page.evaluate(() => bullets[0].y);
            await advance(page, 10);
            expect(await page.evaluate(() => bullets[0].y)).toBe(y0);
        });

        test('only a few lasers can be in the air at once', async ({ page }) => {
            await startClear(page);
            const count = await page.evaluate(() => {
                for (let i = 0; i < 20; i++) fire();
                return bullets.length;
            });
            expect(count).toBeLessThanOrEqual(MAX_BULLETS);
            expect(count).toBeGreaterThan(0);
        });

        test('lasers expire once they leave the screen', async ({ page }) => {
            await startClear(page);
            await page.evaluate(() => fire());
            await advance(page, 240);
            expect(await page.evaluate(() => bullets.length)).toBe(0);
        });

        test('B drops a bomb that falls in an arc', async ({ page }) => {
            await startClear(page);
            await page.keyboard.press('b');
            expect(await page.evaluate(() => bombs.length)).toBe(1);
            const first = await page.evaluate(() => ({ x: bombs[0].x, y: bombs[0].y, vy: bombs[0].vy }));
            await advance(page, 12);
            const second = await page.evaluate(() => ({ x: bombs[0].x, y: bombs[0].y, vy: bombs[0].vy }));
            expect(second.y).toBeGreaterThan(first.y);
            expect(second.x).toBeGreaterThan(first.x);
            expect(second.vy).toBeGreaterThan(first.vy);
        });

        test('a bomb bursts when it reaches the cave floor', async ({ page }) => {
            await startClear(page);
            const start = await page.evaluate(() => {
                dropBomb();
                return bombs[0].y;
            });
            await advanceUntil(page, 'bombs.length === 0');
            const burst = await page.evaluate(() => ({ blasts: blasts.length, ground: groundAt(ship.x) }));
            expect(burst.blasts).toBeGreaterThan(0);
            expect(start).toBeLessThan(burst.ground);
        });

        test('weapons stay holstered until the run starts', async ({ page }) => {
            await page.keyboard.press('b');
            expect(await page.evaluate(() => bombs.length)).toBe(0);
            expect(await page.evaluate(() => state)).toBe('idle');
        });
    });

    // -----------------------------------------------------------------------
    // Fuel
    // -----------------------------------------------------------------------
    test.describe('fuel', () => {
        test('fuel burns off while flying', async ({ page }) => {
            await startClear(page);
            await advance(page, 120);
            expect(await page.evaluate(() => fuel)).toBeLessThan(FUEL_MAX);
        });

        test('the HUD tracks the fuel that is left', async ({ page }) => {
            await startClear(page);
            // Paused first, so the live animation loop cannot burn the reading
            // down to 41 while the assertion is being made.
            await page.evaluate(() => {
                togglePause();
                fuel = 42.6;
                updateHud();
            });
            await expect(page.locator('#fuel')).toHaveText('42');
        });

        test('the fuel gauge shrinks as fuel burns', async ({ page }) => {
            await startClear(page);
            await page.evaluate(() => {
                togglePause();
                fuel = 25;
                updateHud();
            });
            const width = await page.locator('#fuel-bar').evaluate((el) => el.style.width);
            expect(width).toBe('25%');
        });

        test('bombing a fuel tank tops the ship up and scores', async ({ page }) => {
            const result = await page.evaluate(() => {
                startGame();
                flattenTerrain();
                rockets.length = 0;
                tanks.length = 0;
                fuel = 40;
                tanks.push({ x: ship.x + 60, y: groundAt(ship.x + 60), alive: true });
                bombs.push({ x: tanks[0].x, y: tanks[0].y - 6, vx: 0, vy: 0 });
                step(1 / 60);
                return { fuel, score, alive: tanks[0].alive };
            });
            expect(result.alive).toBe(false);
            expect(result.fuel).toBeGreaterThan(40);
            expect(result.score).toBe(TANK_POINTS);
        });

        test('a laser can pop a fuel tank as well as a bomb', async ({ page }) => {
            const result = await page.evaluate(() => {
                startGame();
                flattenTerrain();
                rockets.length = 0;
                tanks.length = 0;
                fuel = 40;
                tanks.push({ x: ship.x + 60, y: groundAt(ship.x + 60), alive: true });
                bullets.push({ x: tanks[0].x, y: tanks[0].y - 6 });
                step(1 / 60);
                return { fuel, alive: tanks[0].alive };
            });
            expect(result.alive).toBe(false);
            expect(result.fuel).toBeGreaterThan(40);
        });

        test('fuel never overfills past the tank', async ({ page }) => {
            const after = await page.evaluate(() => {
                startGame();
                flattenTerrain();
                rockets.length = 0;
                tanks.length = 0;
                fuel = FUEL_MAX - 2;
                tanks.push({ x: ship.x + 60, y: groundAt(ship.x + 60), alive: true });
                bombs.push({ x: tanks[0].x, y: tanks[0].y - 6, vx: 0, vy: 0 });
                step(1 / 60);
                return fuel;
            });
            expect(after).toBe(FUEL_MAX);
        });

        test('running dry crashes the ship', async ({ page }) => {
            await startClear(page);
            const after = await page.evaluate(() => {
                fuel = 0.001;
                step(1 / 60);
                return { state, lives };
            });
            expect(after.state).toBe('dying');
            expect(after.lives).toBe(2);
        });

        test('a fresh level starts with a full tank', async ({ page }) => {
            await startClear(page);
            await page.evaluate(() => {
                fuel = 30;
                scrollX = levelLength(level);
                step(1 / 60);
            });
            await advanceUntil(page, "state === 'running'");
            expect(await page.evaluate(() => fuel)).toBeGreaterThan(FUEL_MAX * 0.95);
        });
    });

    // -----------------------------------------------------------------------
    // Targets
    // -----------------------------------------------------------------------
    test.describe('targets', () => {
        test('a level is stocked with fuel tanks and rockets', async ({ page }) => {
            await page.evaluate(() => startGame());
            expect(await page.evaluate(() => tanks.length)).toBeGreaterThan(0);
            expect(await page.evaluate(() => rockets.length)).toBeGreaterThan(0);
        });

        test('targets sit on the cave floor', async ({ page }) => {
            await page.evaluate(() => startGame());
            const seated = await page.evaluate(() =>
                [...tanks, ...rockets].every((t) => Math.abs(t.y - groundAt(t.x)) < 1)
            );
            expect(seated).toBe(true);
        });

        test('targets are spread through the cave, not bunched at the start', async ({ page }) => {
            const spread = await page.evaluate(() => {
                startGame();
                const xs = [...tanks, ...rockets].map((t) => t.x);
                return { min: Math.min(...xs), max: Math.max(...xs), len: levelLength(level) };
            });
            expect(spread.min).toBeGreaterThan(CANVAS_W / 2);
            expect(spread.max).toBeGreaterThan(spread.len / 2);
        });

        test('shooting a rocket scores and removes it', async ({ page }) => {
            const result = await page.evaluate(() => {
                startGame();
                flattenTerrain();
                rockets.length = 0;
                tanks.length = 0;
                rockets.push({ x: ship.x + 80, y: groundAt(ship.x + 80), launched: false, alive: true });
                bullets.push({ x: rockets[0].x, y: rockets[0].y - 8 });
                step(1 / 60);
                return { alive: rockets[0].alive, score, bullets: bullets.length };
            });
            expect(result.alive).toBe(false);
            expect(result.score).toBe(ROCKET_POINTS);
            expect(result.bullets).toBe(0);
        });

        test('a rocket launches when the ship closes in', async ({ page }) => {
            // 150px ahead is inside any sane launch range; 900px ahead — more
            // than a screen away — must not be, or the cave would be a wall of
            // rockets before the player could see them.
            const launched = await page.evaluate(() => {
                const place = (ahead) => {
                    startGame();
                    flattenTerrain();
                    rockets.length = 0;
                    tanks.length = 0;
                    rockets.push({
                        x: ship.x + ahead,
                        y: groundAt(ship.x + ahead),
                        launched: false,
                        alive: true,
                    });
                    step(1 / 60);
                    return rockets[0].launched;
                };
                return { near: place(150), far: place(900) };
            });
            expect(launched).toEqual({ near: true, far: false });
        });

        test('a rocket sitting right at the launch range goes off', async ({ page }) => {
            const launched = await page.evaluate(() => {
                startGame();
                flattenTerrain();
                rockets.length = 0;
                tanks.length = 0;
                rockets.push({
                    x: ship.x + LAUNCH_RANGE - 20,
                    y: groundAt(ship.x + 40),
                    launched: false,
                    alive: true,
                });
                step(1 / 60);
                return rockets[0].launched;
            });
            expect(launched).toBe(true);
        });

        test('a rocket beyond the launch range stays on the ground', async ({ page }) => {
            const launched = await page.evaluate(() => {
                startGame();
                flattenTerrain();
                rockets.length = 0;
                tanks.length = 0;
                rockets.push({
                    x: ship.x + LAUNCH_RANGE + 400,
                    y: groundAt(ship.x + 40),
                    launched: false,
                    alive: true,
                });
                step(1 / 60);
                return rockets[0].launched;
            });
            expect(launched).toBe(false);
        });

        test('a launched rocket climbs', async ({ page }) => {
            const climb = await page.evaluate(() => {
                startGame();
                flattenTerrain();
                rockets.length = 0;
                tanks.length = 0;
                rockets.push({
                    x: ship.x + 100,
                    y: groundAt(ship.x + 100),
                    launched: true,
                    alive: true,
                });
                const before = rockets[0].y;
                for (let i = 0; i < 20; i++) step(1 / 60);
                return { before, after: rockets[0].y };
            });
            expect(climb.after).toBeLessThan(climb.before);
        });

        test('a rocket that hits the ship costs a life', async ({ page }) => {
            const result = await page.evaluate(() => {
                startGame();
                flattenTerrain();
                rockets.length = 0;
                tanks.length = 0;
                rockets.push({ x: ship.x, y: ship.y, launched: true, alive: true });
                step(1 / 60);
                return { state, lives };
            });
            expect(result.state).toBe('dying');
            expect(result.lives).toBe(2);
        });

        test('targets left behind are cleaned up', async ({ page }) => {
            await startClear(page);
            const left = await page.evaluate(() => {
                rockets.push({ x: scrollX - 400, y: 300, launched: true, alive: true });
                step(1 / 60);
                return rockets.length;
            });
            expect(left).toBe(0);
        });
    });

    // -----------------------------------------------------------------------
    // Crashing
    // -----------------------------------------------------------------------
    test.describe('crashing', () => {
        test('flying into the cave floor costs a life', async ({ page }) => {
            await startClear(page);
            const after = await page.evaluate(() => {
                ship.y = groundAt(ship.x) + 4;
                step(1 / 60);
                return { state, lives };
            });
            expect(after.state).toBe('dying');
            expect(after.lives).toBe(2);
        });

        test('scraping the ceiling costs a life', async ({ page }) => {
            await startClear(page);
            const after = await page.evaluate(() => {
                ship.y = ceilAt(ship.x) - 4;
                step(1 / 60);
                return state;
            });
            expect(after).toBe('dying');
        });

        test('a crash leaves an explosion on screen', async ({ page }) => {
            await startClear(page);
            const count = await page.evaluate(() => {
                ship.y = groundAt(ship.x) + 4;
                step(1 / 60);
                return blasts.length;
            });
            expect(count).toBeGreaterThan(0);
        });

        test('the run restarts the level after the crash pause', async ({ page }) => {
            await startClear(page);
            await page.evaluate(() => {
                scrollX = 900;
                ship.x = scrollX + 120;
                ship.y = groundAt(ship.x) + 4;
                step(1 / 60);
            });
            await advanceUntil(page, "state === 'running'");
            const after = await page.evaluate(() => ({ state, scrollX, level }));
            expect(after.state).toBe('running');
            expect(after.scrollX).toBeLessThan(200);
            expect(after.level).toBe(1);
        });

        test('a restarted level restocks its targets', async ({ page }) => {
            await page.evaluate(() => {
                startGame();
                tanks.length = 0;
                rockets.length = 0;
                ship.y = groundAt(ship.x) + 4;
                step(1 / 60);
            });
            await advanceUntil(page, "state === 'running'");
            expect(await page.evaluate(() => tanks.length)).toBeGreaterThan(0);
            expect(await page.evaluate(() => rockets.length)).toBeGreaterThan(0);
        });

        test('the score survives a crash', async ({ page }) => {
            await startClear(page);
            await page.evaluate(() => {
                score = 900;
                ship.y = groundAt(ship.x) + 4;
                step(1 / 60);
            });
            await advanceUntil(page, "state === 'running'");
            expect(await page.evaluate(() => score)).toBe(900);
        });

        test('the last life ends the run', async ({ page }) => {
            await startClear(page);
            await page.evaluate(() => {
                lives = 1;
                ship.y = groundAt(ship.x) + 4;
                step(1 / 60);
            });
            await advanceUntil(page, "state === 'over'");
            await expect(page.locator('#overlay')).toHaveClass(/visible/);
            await expect(page.locator('#overlay-title')).toContainText(/over/i);
        });

        test('game over records a new best score', async ({ page }) => {
            await startClear(page);
            await page.evaluate(() => {
                lives = 1;
                score = 3300;
                ship.y = groundAt(ship.x) + 4;
                step(1 / 60);
            });
            await advanceUntil(page, "state === 'over'");
            expect(await page.evaluate(() => window.localStorage.getItem('scramble-best'))).toBe('3300');
            await expect(page.locator('#best')).toHaveText('3300');
        });

        test('Space starts a fresh run after game over', async ({ page }) => {
            await startClear(page);
            await page.evaluate(() => {
                lives = 1;
                ship.y = groundAt(ship.x) + 4;
                step(1 / 60);
            });
            await advanceUntil(page, "state === 'over'");
            await page.keyboard.press('Space');
            const s = await page.evaluate(() => ({ state, lives, score }));
            expect(s).toEqual({ state: 'running', lives: 3, score: 0 });
        });
    });

    // -----------------------------------------------------------------------
    // Levels
    // -----------------------------------------------------------------------
    test.describe('levels', () => {
        test('reaching the end of the cave clears the level', async ({ page }) => {
            await startClear(page);
            const after = await page.evaluate(() => {
                scrollX = levelLength(level);
                step(1 / 60);
                return state;
            });
            expect(after).toBe('cleared');
        });

        test('clearing a level pays a bonus', async ({ page }) => {
            await startClear(page);
            const scored = await page.evaluate(() => {
                score = 0;
                scrollX = levelLength(level);
                step(1 / 60);
                return score;
            });
            expect(scored).toBeGreaterThanOrEqual(CLEAR_BONUS);
        });

        test('the next level starts after the clear pause', async ({ page }) => {
            await startClear(page);
            await page.evaluate(() => {
                scrollX = levelLength(level);
                step(1 / 60);
            });
            await advanceUntil(page, "state === 'running'");
            const after = await page.evaluate(() => ({ state, level, scrollX }));
            expect(after.state).toBe('running');
            expect(after.level).toBe(2);
            expect(after.scrollX).toBeLessThan(200);
        });

        test('later caves scroll faster', async ({ page }) => {
            const speeds = await page.evaluate(() => [scrollSpeed(1), scrollSpeed(2), scrollSpeed(5)]);
            expect(speeds[1]).toBeGreaterThan(speeds[0]);
            expect(speeds[2]).toBeGreaterThan(speeds[1]);
        });

        test('later caves are longer', async ({ page }) => {
            const lengths = await page.evaluate(() => [levelLength(1), levelLength(2)]);
            expect(lengths[1]).toBeGreaterThan(lengths[0]);
        });

        test('the HUD shows the level number', async ({ page }) => {
            await startClear(page);
            await page.evaluate(() => {
                scrollX = levelLength(level);
                step(1 / 60);
            });
            await advanceUntil(page, "state === 'running'");
            await expect(page.locator('#level')).toHaveText('2');
        });

        test('progress reports how far into the cave the ship has flown', async ({ page }) => {
            await startClear(page);
            await advance(page, 120);
            const pct = await page.evaluate(() => progress());
            expect(pct).toBeGreaterThan(0);
            expect(pct).toBeLessThan(1);
        });
    });

    // -----------------------------------------------------------------------
    // Pausing
    // -----------------------------------------------------------------------
    test.describe('pausing', () => {
        test('P pauses and resumes', async ({ page }) => {
            await startClear(page);
            await page.keyboard.press('p');
            expect(await page.evaluate(() => state)).toBe('paused');
            await page.keyboard.press('p');
            expect(await page.evaluate(() => state)).toBe('running');
        });

        test('a paused cave does not scroll or burn fuel', async ({ page }) => {
            await startClear(page);
            await page.keyboard.press('p');
            const before = await page.evaluate(() => ({ scrollX, fuel }));
            await advance(page, 60);
            const after = await page.evaluate(() => ({ scrollX, fuel }));
            expect(after).toEqual(before);
        });

        test('the pause overlay explains how to resume', async ({ page }) => {
            await startClear(page);
            await page.keyboard.press('p');
            await expect(page.locator('#overlay')).toHaveClass(/visible/);
            await expect(page.locator('#overlay-title')).toContainText(/paused/i);
        });

        test('pausing is ignored before the run starts', async ({ page }) => {
            await page.keyboard.press('p');
            expect(await page.evaluate(() => state)).toBe('idle');
        });
    });

    // -----------------------------------------------------------------------
    // Scoring / HUD
    // -----------------------------------------------------------------------
    test.describe('scoring', () => {
        test('the HUD score updates as targets are destroyed', async ({ page }) => {
            await page.evaluate(() => {
                startGame();
                flattenTerrain();
                rockets.length = 0;
                tanks.length = 0;
                rockets.push({ x: ship.x + 80, y: groundAt(ship.x + 80), launched: false, alive: true });
                bullets.push({ x: rockets[0].x, y: rockets[0].y - 8 });
                step(1 / 60);
            });
            await expect(page.locator('#score')).toHaveText(String(ROCKET_POINTS));
        });

        test('a fuel tank is worth more than a rocket', async ({ page }) => {
            const points = await page.evaluate(() => ({ tank: TANK_POINTS, rocket: ROCKET_POINTS }));
            expect(points).toEqual({ tank: TANK_POINTS, rocket: ROCKET_POINTS });
            expect(points.tank).toBeGreaterThan(points.rocket);
        });

        test('the best score only goes up', async ({ page }) => {
            await page.evaluate(() => window.localStorage.setItem('scramble-best', '9000'));
            await page.reload();
            await startClear(page);
            await page.evaluate(() => {
                lives = 1;
                score = 100;
                ship.y = groundAt(ship.x) + 4;
                step(1 / 60);
            });
            await advanceUntil(page, "state === 'over'");
            expect(await page.evaluate(() => window.localStorage.getItem('scramble-best'))).toBe('9000');
        });
    });

    // -----------------------------------------------------------------------
    // Rendering
    // -----------------------------------------------------------------------
    test.describe('rendering', () => {
        test('the canvas paints the cave once the run starts', async ({ page }) => {
            const painted = await page.evaluate(() => {
                startGame();
                draw();
                const data = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
                const seen = new Set();
                for (let i = 0; i < data.length; i += 4) {
                    seen.add(`${data[i]},${data[i + 1]},${data[i + 2]}`);
                    if (seen.size > 3) return true;
                }
                return false;
            });
            expect(painted).toBe(true);
        });

        test('the help text lists the controls', async ({ page }) => {
            const help = page.locator('.help');
            await expect(help).toContainText(/fly|steer/i);
            await expect(help).toContainText(/fire/i);
            await expect(help).toContainText(/bomb/i);
            await expect(help).toContainText(/pause/i);
        });
    });
});
