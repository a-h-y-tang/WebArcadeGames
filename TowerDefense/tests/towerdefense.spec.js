const { test, expect } = require('@playwright/test');
const path = require('path');
const { pathToFileURL } = require('url');

const GAME_URL = pathToFileURL(path.resolve(__dirname, '../index.html')).href;

// Advance the simulation deterministically: `frames` calls to step(dt).
// The render loop only ever turns wall-clock into a dt and calls step(), so
// driving step() directly exercises exactly the same code the game runs.
const advance = (page, frames, dt = 1 / 60) =>
    page.evaluate(([f, d]) => {
        for (let i = 0; i < f; i++) step(d);
    }, [frames, dt]);

// Grass tiles well clear of the road, used for building in most specs.
const GRASS = { col: 5, col2: 6, row: 5 };
// A tile the road runs through.
const ROAD = { col: 5, row: 2 };

const start = (page) => page.evaluate(() => startGame());

const pressAndSettle = async (page, key, predicate) => {
    await page.keyboard.press(key);
    await page.waitForFunction(predicate);
};

test.describe('Tower Defense', () => {
    test.beforeEach(async ({ page }) => {
        await page.goto(GAME_URL);
    });

    // -----------------------------------------------------------------------
    // Initial state
    // -----------------------------------------------------------------------
    test.describe('initial state', () => {
        test('page title is Tower Defense', async ({ page }) => {
            await expect(page).toHaveTitle('Tower Defense');
        });

        test('canvas is a 20x15 grid of 32px tiles', async ({ page }) => {
            const size = await page.evaluate(() => {
                const c = document.getElementById('canvas');
                return { w: c.width, h: c.height, tile: TILE, cols: COLS, rows: ROWS };
            });
            expect(size).toEqual({ w: 640, h: 480, tile: 32, cols: 20, rows: 15 });
        });

        test('starts on the menu with the overlay showing', async ({ page }) => {
            expect(await page.evaluate(() => state)).toBe('menu');
            await expect(page.locator('#overlay')).toHaveClass(/visible/);
        });

        test('opens with the starting gold, lives and wave counter', async ({ page }) => {
            const hud = await page.evaluate(() => ({ gold, lives, wave, score }));
            expect(hud).toEqual({ gold: 150, lives: 20, wave: 0, score: 0 });
        });

        test('board is empty before the first wave', async ({ page }) => {
            const counts = await page.evaluate(() => ({
                towers: towers.length,
                enemies: enemies.length,
                projectiles: projectiles.length,
            }));
            expect(counts).toEqual({ towers: 0, enemies: 0, projectiles: 0 });
        });
    });

    // -----------------------------------------------------------------------
    // The map
    // -----------------------------------------------------------------------
    test.describe('map', () => {
        test('road tiles are road and cannot be built on', async ({ page }) => {
            const road = await page.evaluate(() =>
                [[5, 2], [16, 5], [10, 7], [3, 10], [10, 12]].map(([c, r]) => ({
                    road: isRoad(c, r),
                    buildable: isBuildable(c, r),
                }))
            );
            for (const tile of road) expect(tile).toEqual({ road: true, buildable: false });
        });

        test('grass tiles beside the road are buildable', async ({ page }) => {
            const grass = await page.evaluate(() =>
                [[5, 5], [1, 0], [18, 9], [12, 14]].map(([c, r]) => ({
                    road: isRoad(c, r),
                    buildable: isBuildable(c, r),
                }))
            );
            for (const tile of grass) expect(tile).toEqual({ road: false, buildable: true });
        });

        test('tiles outside the grid are not buildable', async ({ page }) => {
            const outside = await page.evaluate(() =>
                [[-1, 5], [20, 5], [5, -1], [5, 15]].map(([c, r]) => isBuildable(c, r))
            );
            expect(outside).toEqual([false, false, false, false]);
        });

        test('the path runs from off-screen left to off-screen right', async ({ page }) => {
            const ends = await page.evaluate(() => {
                const a = pathPointAt(0);
                const b = pathPointAt(pathLength);
                return { ax: a.x, ay: a.y, bx: b.x, by: b.y, len: pathLength };
            });
            expect(ends.ax).toBeLessThan(0);
            expect(ends.bx).toBeGreaterThan(640);
            expect(ends.len).toBeGreaterThan(640);
        });
    });

    // -----------------------------------------------------------------------
    // Starting a run
    // -----------------------------------------------------------------------
    test.describe('starting a run', () => {
        test('startGame puts the game into play and hides the overlay', async ({ page }) => {
            await start(page);
            const s = await page.evaluate(() => ({ state, gold, lives, wave, score }));
            expect(s).toEqual({ state: 'playing', gold: 150, lives: 20, wave: 0, score: 0 });
            await expect(page.locator('#overlay')).not.toHaveClass(/visible/);
        });

        test('Space starts the game from the menu', async ({ page }) => {
            await pressAndSettle(page, 'Space', () => state === 'playing');
        });

        test('the Start button starts the game', async ({ page }) => {
            await page.click('#btn-start');
            await expect.poll(() => page.evaluate(() => state)).toBe('playing');
        });

        test('a run opens with the between-wave countdown running', async ({ page }) => {
            await start(page);
            const s = await page.evaluate(() => ({ waveActive, waveCountdown }));
            expect(s.waveActive).toBe(false);
            expect(s.waveCountdown).toBeGreaterThan(0);
        });
    });

    // -----------------------------------------------------------------------
    // Building towers
    // -----------------------------------------------------------------------
    test.describe('building', () => {
        test.beforeEach(async ({ page }) => {
            await start(page);
        });

        test('placing a tower spends gold and puts it on the tile centre', async ({ page }) => {
            const result = await page.evaluate(([c, r]) => {
                const ok = placeTower(c, r, 'arrow');
                const t = towers[0];
                return { ok, gold, count: towers.length, x: t.x, y: t.y, level: t.level, type: t.type };
            }, [GRASS.col, GRASS.row]);
            expect(result).toEqual({
                ok: true,
                gold: 100,
                count: 1,
                x: GRASS.col * 32 + 16,
                y: GRASS.row * 32 + 16,
                level: 1,
                type: 'arrow',
            });
        });

        test('towers cannot be built on the road', async ({ page }) => {
            const result = await page.evaluate(([c, r]) => {
                const ok = placeTower(c, r, 'arrow');
                return { ok, gold, count: towers.length };
            }, [ROAD.col, ROAD.row]);
            expect(result).toEqual({ ok: false, gold: 150, count: 0 });
        });

        test('a tile only holds one tower', async ({ page }) => {
            const result = await page.evaluate(([c, r]) => {
                placeTower(c, r, 'arrow');
                const ok = placeTower(c, r, 'frost');
                return { ok, gold, count: towers.length };
            }, [GRASS.col, GRASS.row]);
            expect(result).toEqual({ ok: false, gold: 100, count: 1 });
        });

        test('a tower you cannot afford is not built', async ({ page }) => {
            const result = await page.evaluate(([c, r]) => {
                gold = 40;
                const ok = placeTower(c, r, 'arrow');
                return { ok, gold, count: towers.length };
            }, [GRASS.col, GRASS.row]);
            expect(result).toEqual({ ok: false, gold: 40, count: 0 });
        });

        test('towerAt finds the tower on a tile', async ({ page }) => {
            const found = await page.evaluate(([c, r]) => {
                placeTower(c, r, 'cannon');
                return { here: towerAt(c, r)?.type ?? null, elsewhere: towerAt(0, 0) ?? null };
            }, [GRASS.col, GRASS.row]);
            expect(found).toEqual({ here: 'cannon', elsewhere: null });
        });

        test('each tower type costs its listed price', async ({ page }) => {
            const costs = await page.evaluate(() => ({
                arrow: TOWER_TYPES.arrow.cost,
                frost: TOWER_TYPES.frost.cost,
                cannon: TOWER_TYPES.cannon.cost,
            }));
            expect(costs).toEqual({ arrow: 50, frost: 75, cannon: 100 });
        });
    });

    // -----------------------------------------------------------------------
    // Mouse and keyboard
    // -----------------------------------------------------------------------
    test.describe('input', () => {
        test.beforeEach(async ({ page }) => {
            await start(page);
        });

        test('number keys pick the tower to build', async ({ page }) => {
            await pressAndSettle(page, '2', () => selectedType === 'frost');
            await pressAndSettle(page, '3', () => selectedType === 'cannon');
            await pressAndSettle(page, '1', () => selectedType === 'arrow');
        });

        test('clicking grass builds the selected tower there', async ({ page }) => {
            const box = await page.locator('#canvas').boundingBox();
            await page.mouse.click(box.x + GRASS.col * 32 + 16, box.y + GRASS.row * 32 + 16);
            await expect.poll(() => page.evaluate(() => towers.length)).toBe(1);
            const t = await page.evaluate(() => ({ col: towers[0].col, row: towers[0].row, gold }));
            expect(t).toEqual({ col: GRASS.col, row: GRASS.row, gold: 100 });
        });

        test('clicking the road builds nothing', async ({ page }) => {
            const box = await page.locator('#canvas').boundingBox();
            await page.mouse.click(box.x + ROAD.col * 32 + 16, box.y + ROAD.row * 32 + 16);
            const s = await page.evaluate(() => ({ towers: towers.length, gold }));
            expect(s).toEqual({ towers: 0, gold: 150 });
        });

        test('clicking a built tower selects it instead of charging again', async ({ page }) => {
            await page.evaluate(([c, r]) => placeTower(c, r, 'arrow'), [GRASS.col, GRASS.row]);
            const box = await page.locator('#canvas').boundingBox();
            await page.mouse.click(box.x + GRASS.col * 32 + 16, box.y + GRASS.row * 32 + 16);
            await expect.poll(() => page.evaluate(() => selectedTower !== null)).toBe(true);
            const s = await page.evaluate(() => ({ gold, towers: towers.length }));
            expect(s).toEqual({ gold: 100, towers: 1 });
        });

        test('Escape clears the selection', async ({ page }) => {
            await page.evaluate(([c, r]) => {
                placeTower(c, r, 'arrow');
                selectedTower = towerAt(c, r);
            }, [GRASS.col, GRASS.row]);
            await pressAndSettle(page, 'Escape', () => selectedTower === null);
        });

        test('P pauses and resumes the simulation', async ({ page }) => {
            await page.evaluate(() => spawnEnemy('grunt', 100));
            await pressAndSettle(page, 'p', () => state === 'paused');
            const before = await page.evaluate(() => enemies[0].dist);
            await advance(page, 60);
            expect(await page.evaluate(() => enemies[0].dist)).toBe(before);
            await pressAndSettle(page, 'p', () => state === 'playing');
            await advance(page, 60);
            expect(await page.evaluate(() => enemies[0].dist)).toBeGreaterThan(before);
        });
    });

    // -----------------------------------------------------------------------
    // Upgrading and selling
    // -----------------------------------------------------------------------
    test.describe('upgrading and selling', () => {
        test.beforeEach(async ({ page }) => {
            await start(page);
            await page.evaluate(([c, r]) => placeTower(c, r, 'arrow'), [GRASS.col, GRASS.row]);
        });

        test('an upgrade costs gold and makes the tower stronger', async ({ page }) => {
            const result = await page.evaluate(() => {
                const t = towers[0];
                const before = { damage: t.damage, range: t.range };
                gold = 500;
                const ok = upgradeTower(t);
                return {
                    ok,
                    level: t.level,
                    gold,
                    damageUp: t.damage > before.damage,
                    rangeUp: t.range > before.range,
                };
            });
            expect(result.ok).toBe(true);
            expect(result.level).toBe(2);
            expect(result.gold).toBe(500 - 40); // round(50 * 0.8 * 1)
            expect(result.damageUp).toBe(true);
            expect(result.rangeUp).toBe(true);
        });

        test('a tower can be upgraded twice and no further', async ({ page }) => {
            const result = await page.evaluate(() => {
                const t = towers[0];
                gold = 9999;
                const a = upgradeTower(t);
                const b = upgradeTower(t);
                const c = upgradeTower(t);
                return { a, b, c, level: t.level };
            });
            expect(result).toEqual({ a: true, b: true, c: false, level: 3 });
        });

        test('an upgrade you cannot afford is refused', async ({ page }) => {
            const result = await page.evaluate(() => {
                gold = 5;
                const ok = upgradeTower(towers[0]);
                return { ok, level: towers[0].level, gold };
            });
            expect(result).toEqual({ ok: false, level: 1, gold: 5 });
        });

        test('selling refunds 60% of everything invested and frees the tile', async ({ page }) => {
            const result = await page.evaluate(([c, r]) => {
                const t = towers[0];
                gold = 100;
                upgradeTower(t); // +40 invested, gold now 60; invested = 90
                selectedTower = t;
                const ok = sellTower(t);
                return {
                    ok,
                    gold,
                    towers: towers.length,
                    buildable: isBuildable(c, r),
                    selected: selectedTower,
                };
            }, [GRASS.col, GRASS.row]);
            expect(result).toEqual({
                ok: true,
                gold: 60 + 54, // 60% of 90 invested
                towers: 0,
                buildable: true,
                selected: null,
            });
        });

        test('U upgrades and S sells the selected tower', async ({ page }) => {
            await page.evaluate(() => {
                gold = 500;
                selectedTower = towers[0];
            });
            await pressAndSettle(page, 'u', () => towers[0].level === 2);
            await pressAndSettle(page, 's', () => towers.length === 0);
        });
    });

    // -----------------------------------------------------------------------
    // Waves
    // -----------------------------------------------------------------------
    test.describe('waves', () => {
        test.beforeEach(async ({ page }) => {
            await start(page);
        });

        test('starting a wave queues 6 + 2n creeps', async ({ page }) => {
            const s = await page.evaluate(() => {
                startWave();
                return { wave, waveActive, queued: spawnQueue.length };
            });
            expect(s).toEqual({ wave: 1, waveActive: true, queued: 8 });
        });

        test('early waves are grunts, later waves mix in runners and tanks', async ({ page }) => {
            const comps = await page.evaluate(() => ({
                one: waveComposition(1),
                three: waveComposition(3),
                six: waveComposition(6),
            }));
            expect(comps.one.every((t) => t === 'grunt')).toBe(true);
            expect(comps.three).toContain('runner');
            expect(comps.six).toContain('tank');
        });

        test('every fifth wave brings a boss', async ({ page }) => {
            const bosses = await page.evaluate(() =>
                [1, 4, 5, 9, 10].map((n) => waveComposition(n).includes('boss'))
            );
            expect(bosses).toEqual([false, false, true, false, true]);
        });

        test('enemy health scales with the wave number', async ({ page }) => {
            const hp = await page.evaluate(() => {
                startGame();
                wave = 1;
                const a = spawnEnemy('grunt').maxHp;
                wave = 6;
                const b = spawnEnemy('grunt').maxHp;
                return { a, b };
            });
            expect(hp.a).toBe(30);
            expect(hp.b).toBeGreaterThan(hp.a);
        });

        test('creeps spawn one at a time as the wave runs', async ({ page }) => {
            await page.evaluate(() => startWave());
            await advance(page, 120);
            const s = await page.evaluate(() => ({ spawned: enemies.length, queued: spawnQueue.length }));
            expect(s.spawned).toBeGreaterThan(0);
            expect(s.spawned).toBeLessThan(8);
            expect(s.queued).toBeGreaterThan(0);
        });

        test('the countdown calls the next wave on its own', async ({ page }) => {
            await advance(page, 600); // 10s > the 8s countdown
            const s = await page.evaluate(() => ({ wave, waveActive }));
            expect(s).toEqual({ wave: 1, waveActive: true });
        });

        test('Space calls the next wave in early', async ({ page }) => {
            await pressAndSettle(page, 'Space', () => waveActive === true);
            expect(await page.evaluate(() => wave)).toBe(1);
        });

        test('clearing a wave pays a bonus and restarts the countdown', async ({ page }) => {
            const s = await page.evaluate(() => {
                startWave();
                spawnQueue.length = 0;
                enemies.length = 0;
                const before = gold;
                step(0.1);
                return { gained: gold - before, waveActive, wave, countdown: waveCountdown };
            });
            expect(s.gained).toBe(25); // 20 + 5 * wave 1
            expect(s.waveActive).toBe(false);
            expect(s.wave).toBe(1);
            expect(s.countdown).toBeGreaterThan(0);
        });

        test('clearing the final wave wins the game', async ({ page }) => {
            const s = await page.evaluate(() => {
                wave = WAVE_COUNT - 1;
                startWave();
                spawnQueue.length = 0;
                enemies.length = 0;
                step(0.1);
                return { state, wave };
            });
            expect(s).toEqual({ state: 'victory', wave: 20 });
            await expect(page.locator('#overlay')).toHaveClass(/visible/);
            await expect(page.locator('#overlay-title')).toHaveText(/victory/i);
        });
    });

    // -----------------------------------------------------------------------
    // Creeps walking the road
    // -----------------------------------------------------------------------
    test.describe('creeps', () => {
        test.beforeEach(async ({ page }) => {
            await start(page);
        });

        test('a creep walks east along the first leg of the road', async ({ page }) => {
            await page.evaluate(() => spawnEnemy('grunt', 40));
            const before = await page.evaluate(() => ({ x: enemies[0].x, y: enemies[0].y }));
            await advance(page, 60);
            const after = await page.evaluate(() => ({ x: enemies[0].x, y: enemies[0].y }));
            expect(after.x).toBeGreaterThan(before.x);
            expect(after.y).toBeCloseTo(2 * 32 + 16, 1);
        });

        test('a creep turns south at the first corner', async ({ page }) => {
            await page.evaluate(() => {
                // Just past the (16,2) corner.
                const corner = 16 * 32 + 16 - pathPointAt(0).x;
                spawnEnemy('grunt', corner + 10);
            });
            const before = await page.evaluate(() => ({ x: enemies[0].x, y: enemies[0].y }));
            await advance(page, 60);
            const after = await page.evaluate(() => ({ x: enemies[0].x, y: enemies[0].y }));
            expect(after.y).toBeGreaterThan(before.y);
            expect(after.x).toBeCloseTo(before.x, 1);
        });

        test('creeps move at their own speeds', async ({ page }) => {
            const moved = await page.evaluate(() => {
                const grunt = spawnEnemy('grunt', 0);
                const runner = spawnEnemy('runner', 0);
                const tank = spawnEnemy('tank', 0);
                for (let i = 0; i < 60; i++) step(1 / 60);
                return { grunt: grunt.dist, runner: runner.dist, tank: tank.dist };
            });
            expect(moved.runner).toBeGreaterThan(moved.grunt);
            expect(moved.grunt).toBeGreaterThan(moved.tank);
        });

        test('a creep that reaches the end costs a life and leaves', async ({ page }) => {
            await page.evaluate(() => spawnEnemy('grunt', pathLength - 5));
            await advance(page, 30);
            const s = await page.evaluate(() => ({ lives, enemies: enemies.length }));
            expect(s).toEqual({ lives: 19, enemies: 0 });
        });

        test('a tank that escapes costs two lives', async ({ page }) => {
            await page.evaluate(() => spawnEnemy('tank', pathLength - 3));
            await advance(page, 30);
            expect(await page.evaluate(() => lives)).toBe(18);
        });

        test('losing the last life ends the run', async ({ page }) => {
            await page.evaluate(() => {
                lives = 1;
                spawnEnemy('grunt', pathLength - 3);
            });
            await advance(page, 30);
            const s = await page.evaluate(() => ({ state, lives }));
            expect(s).toEqual({ state: 'gameover', lives: 0 });
            await expect(page.locator('#overlay')).toHaveClass(/visible/);
        });
    });

    // -----------------------------------------------------------------------
    // Towers shooting
    // -----------------------------------------------------------------------
    test.describe('combat', () => {
        test.beforeEach(async ({ page }) => {
            await start(page);
        });

        test('a tower shoots a creep that walks into range', async ({ page }) => {
            await page.evaluate(() => {
                gold = 999;
                placeTower(5, 3, 'arrow'); // one tile below the first leg of road
                spawnEnemy('grunt', 5 * 32 + 16 - pathPointAt(0).x);
            });
            await advance(page, 90);
            const s = await page.evaluate(() => ({
                fired: towers[0].shots,
                hurt: enemies.length === 0 || enemies[0].hp < enemies[0].maxHp,
            }));
            expect(s.fired).toBeGreaterThan(0);
            expect(s.hurt).toBe(true);
        });

        test('a tower ignores creeps outside its range', async ({ page }) => {
            await page.evaluate(() => {
                gold = 999;
                placeTower(1, 13, 'arrow'); // bottom-left, far from the first leg
                spawnEnemy('grunt', 60);
            });
            await advance(page, 120);
            const s = await page.evaluate(() => ({
                fired: towers[0].shots,
                projectiles: projectiles.length,
                hp: enemies[0].hp,
                maxHp: enemies[0].maxHp,
            }));
            expect(s.fired).toBe(0);
            expect(s.projectiles).toBe(0);
            expect(s.hp).toBe(s.maxHp);
        });

        test('killing a creep pays its bounty and scores', async ({ page }) => {
            await page.evaluate(() => {
                gold = 999;
                placeTower(5, 3, 'arrow');
                const e = spawnEnemy('grunt', 5 * 32 + 16 - pathPointAt(0).x);
                e.hp = 1;
                goldBefore = gold;
            });
            await advance(page, 120);
            const s = await page.evaluate(() => ({
                gained: gold - goldBefore,
                score,
                enemies: enemies.length,
            }));
            expect(s.enemies).toBe(0);
            expect(s.gained).toBe(8);
            expect(s.score).toBe(8);
        });

        test('towers target the creep furthest along the road', async ({ page }) => {
            const targeted = await page.evaluate(() => {
                gold = 999;
                placeTower(5, 3, 'arrow');
                const base = 5 * 32 + 16 - pathPointAt(0).x;
                const behind = spawnEnemy('grunt', base - 20);
                const ahead = spawnEnemy('grunt', base + 20);
                for (let i = 0; i < 90; i++) step(1 / 60);
                return { aheadHurt: ahead.hp < ahead.maxHp, behindHurt: behind.hp < behind.maxHp };
            });
            expect(targeted.aheadHurt).toBe(true);
            expect(targeted.behindHurt).toBe(false);
        });

        test('a frost tower slows what it hits, and the slow wears off', async ({ page }) => {
            const slowed = await page.evaluate(() => {
                gold = 999;
                placeTower(5, 3, 'frost');
                const e = spawnEnemy('grunt', 5 * 32 + 16 - pathPointAt(0).x);
                for (let i = 0; i < 120; i++) step(1 / 60);
                const during = { timer: e.slowTimer, speed: currentSpeed(e), base: e.speed };
                for (let i = 0; i < 240; i++) step(1 / 60);
                return { during, after: currentSpeed(e), base: e.speed };
            });
            expect(slowed.during.timer).toBeGreaterThan(0);
            expect(slowed.during.speed).toBeLessThan(slowed.during.base);
            expect(slowed.after).toBeCloseTo(slowed.base, 5);
        });

        test('a cannon shell splashes onto nearby creeps', async ({ page }) => {
            const splash = await page.evaluate(() => {
                gold = 999;
                placeTower(5, 3, 'cannon');
                const base = 5 * 32 + 16 - pathPointAt(0).x;
                const a = spawnEnemy('tank', base);
                const b = spawnEnemy('tank', base - 20); // inside the splash radius
                const far = spawnEnemy('tank', base - 260); // well outside it
                for (let i = 0; i < 150; i++) step(1 / 60);
                return {
                    a: a.hp < a.maxHp,
                    b: b.hp < b.maxHp,
                    far: far.hp < far.maxHp,
                    partial: b.hp > a.hp,
                };
            });
            expect(splash.a).toBe(true);
            expect(splash.b).toBe(true);
            expect(splash.far).toBe(false);
            expect(splash.partial).toBe(true);
        });

        test('an upgraded tower hits harder', async ({ page }) => {
            const damage = await page.evaluate(() => {
                gold = 9999;
                placeTower(5, 3, 'arrow');
                const t = towers[0];
                const base = t.damage;
                upgradeTower(t);
                return { base, upgraded: t.damage };
            });
            expect(damage.upgraded).toBeCloseTo(damage.base * 1.5, 5);
        });
    });

    // -----------------------------------------------------------------------
    // HUD and persistence
    // -----------------------------------------------------------------------
    test.describe('hud', () => {
        test('the HUD tracks gold, lives and wave', async ({ page }) => {
            await start(page);
            await page.evaluate(() => {
                placeTower(5, 5, 'arrow');
                startWave();
                lives = 17;
                draw();
                updateHud();
            });
            await expect(page.locator('#gold')).toHaveText('100');
            await expect(page.locator('#lives')).toHaveText('17');
            await expect(page.locator('#wave')).toHaveText('1/20');
        });

        test('the best score survives a reload', async ({ page }) => {
            await start(page);
            await page.evaluate(() => {
                score = 321;
                lives = 1;
                spawnEnemy('grunt', pathLength - 3);
            });
            await advance(page, 30);
            await expect.poll(() => page.evaluate(() => state)).toBe('gameover');
            expect(await page.evaluate(() => localStorage.getItem('towerDefenseBest'))).toBe('321');
            await page.reload();
            await expect(page.locator('#best')).toHaveText('321');
        });

        test('a finished run can be restarted', async ({ page }) => {
            await start(page);
            await page.evaluate(() => {
                lives = 1;
                spawnEnemy('grunt', pathLength - 3);
            });
            await advance(page, 30);
            await expect.poll(() => page.evaluate(() => state)).toBe('gameover');
            await pressAndSettle(page, 'Space', () => state === 'playing');
            const s = await page.evaluate(() => ({ lives, gold, wave, enemies: enemies.length }));
            expect(s).toEqual({ lives: 20, gold: 150, wave: 0, enemies: 0 });
        });
    });
});
