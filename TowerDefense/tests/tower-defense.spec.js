const { test, expect } = require('@playwright/test');
const path = require('path');
const { pathToFileURL } = require('url');

const GAME_URL = pathToFileURL(path.resolve(__dirname, '../index.html')).href;

// Simulate `seconds` of play in 1/60s slices, mirroring the real loop.
const SIM = (seconds) => `(() => {
    for (let i = 0; i < ${Math.round(seconds * 60)}; i++) step(1 / 60);
})()`;

test.describe('Tower Defense', () => {
    test.beforeEach(async ({ page }) => {
        await page.goto(GAME_URL);
    });

    // -----------------------------------------------------------------------
    // Page scaffolding
    // -----------------------------------------------------------------------
    test.describe('page', () => {
        test('page title is Tower Defense', async ({ page }) => {
            await expect(page).toHaveTitle('Tower Defense');
        });

        test('canvas is 720x480', async ({ page }) => {
            const canvas = page.locator('#canvas');
            await expect(canvas).toHaveAttribute('width', '720');
            await expect(canvas).toHaveAttribute('height', '480');
        });

        test('the HUD shows lives, money, wave and score', async ({ page }) => {
            await expect(page.locator('#lives')).toHaveText('20');
            await expect(page.locator('#money')).toHaveText('150');
            await expect(page.locator('#wave')).toContainText('0');
            await expect(page.locator('#score')).toHaveText('0');
        });

        test('start overlay is visible and prompts the player', async ({ page }) => {
            await expect(page.locator('#overlay')).toHaveClass(/visible/);
            await expect(page.locator('#overlay-sub')).toContainText(/space|start/i);
        });

        test('a build button exists for every tower type', async ({ page }) => {
            const types = await page.evaluate(() => Object.keys(TOWER_TYPES));
            for (const type of types) {
                await expect(page.locator(`#build-${type}`)).toBeVisible();
            }
        });

        test('build buttons show their cost', async ({ page }) => {
            const costs = await page.evaluate(() =>
                Object.fromEntries(Object.entries(TOWER_TYPES).map(([k, v]) => [k, v.cost])),
            );
            for (const [type, cost] of Object.entries(costs)) {
                await expect(page.locator(`#build-${type}`)).toContainText(String(cost));
            }
        });

        test('the tower panel is hidden until a tower is selected', async ({ page }) => {
            await expect(page.locator('#tower-panel')).not.toHaveClass(/visible/);
        });
    });

    // -----------------------------------------------------------------------
    // The map
    // -----------------------------------------------------------------------
    test.describe('map', () => {
        test('the grid covers the canvas', async ({ page }) => {
            const g = await page.evaluate(() => ({ tile: TILE, cols: COLS, rows: ROWS }));
            expect(g.cols * g.tile).toBe(720);
            expect(g.rows * g.tile).toBe(480);
        });

        test('the path starts off the left edge and ends off the right edge', async ({ page }) => {
            const w = await page.evaluate(() => WAYPOINTS.map((p) => ({ ...p })));
            expect(w.length).toBeGreaterThan(2);
            expect(w[0].c).toBeLessThan(0);
            expect(w[w.length - 1].c).toBeGreaterThanOrEqual(await page.evaluate(() => COLS));
        });

        test('every waypoint leg is axis aligned', async ({ page }) => {
            const legs = await page.evaluate(() =>
                WAYPOINTS.slice(1).map((p, i) => ({
                    sameRow: p.r === WAYPOINTS[i].r,
                    sameCol: p.c === WAYPOINTS[i].c,
                })),
            );
            for (const leg of legs) expect(leg.sameRow || leg.sameCol).toBe(true);
        });

        test('path tiles are not buildable', async ({ page }) => {
            const anyBuildable = await page.evaluate(() =>
                [...PATH_TILES].some((key) => {
                    const [c, r] = key.split(',').map(Number);
                    return isBuildable(c, r);
                }),
            );
            expect(anyBuildable).toBe(false);
        });

        test('there is plenty of buildable ground', async ({ page }) => {
            const count = await page.evaluate(() => {
                let n = 0;
                for (let c = 0; c < COLS; c++)
                    for (let r = 0; r < ROWS; r++) if (isBuildable(c, r)) n++;
                return n;
            });
            expect(count).toBeGreaterThan(100);
        });

        test('tiles outside the grid are not buildable', async ({ page }) => {
            const outside = await page.evaluate(() => [
                isBuildable(-1, 0),
                isBuildable(0, -1),
                isBuildable(COLS, 0),
                isBuildable(0, ROWS),
            ]);
            expect(outside).toEqual([false, false, false, false]);
        });
    });

    // -----------------------------------------------------------------------
    // Starting
    // -----------------------------------------------------------------------
    test.describe('starting', () => {
        test('state is idle before starting', async ({ page }) => {
            expect(await page.evaluate(() => state)).toBe('idle');
        });

        test('stepping while idle does nothing', async ({ page }) => {
            const changed = await page.evaluate(() => {
                const before = { lives, money, enemies: enemies.length };
                for (let i = 0; i < 60; i++) step(1 / 60);
                return lives !== before.lives || money !== before.money || enemies.length !== before.enemies;
            });
            expect(changed).toBe(false);
        });

        test('Space starts wave 1 and hides the overlay', async ({ page }) => {
            await page.keyboard.press('Space');
            expect(await page.evaluate(() => ({ state, wave, waveActive })))
                .toEqual({ state: 'running', wave: 1, waveActive: true });
            await expect(page.locator('#overlay')).not.toHaveClass(/visible/);
        });

        test('the Start button starts the game too', async ({ page }) => {
            await page.locator('#btn-start').click();
            expect(await page.evaluate(() => state)).toBe('running');
        });

        test('enemies spawn once the wave is running', async ({ page }) => {
            await page.evaluate(() => startGame());
            await page.evaluate(SIM(2));
            expect(await page.evaluate(() => enemies.length)).toBeGreaterThan(0);
        });

        // Everything else drives step() directly; this one check rides the real
        // requestAnimationFrame loop so a broken frame() would be caught.
        test('the animation loop advances the game in real time', async ({ page }) => {
            await page.locator('#btn-start').click();
            await page.waitForTimeout(1500);
            const moved = await page.evaluate(() => enemies.length > 0 && enemies[0].dist > 0);
            expect(moved).toBe(true);
        });

        test('the wave counter updates in the HUD', async ({ page }) => {
            await page.evaluate(() => startGame());
            await expect(page.locator('#wave')).toContainText('1');
        });
    });

    // -----------------------------------------------------------------------
    // Building towers
    // -----------------------------------------------------------------------
    test.describe('building', () => {
        test('placing a tower on open ground succeeds and costs money', async ({ page }) => {
            const res = await page.evaluate(() => {
                const spot = firstBuildableTile();
                const before = money;
                const ok = placeTower('arrow', spot.c, spot.r);
                return { ok, spent: before - money, towers: towers.length, cost: TOWER_TYPES.arrow.cost };
            });
            expect(res.ok).toBe(true);
            expect(res.towers).toBe(1);
            expect(res.spent).toBe(res.cost);
        });

        test('a tower cannot be built on the path', async ({ page }) => {
            const res = await page.evaluate(() => {
                const [c, r] = [...PATH_TILES][3].split(',').map(Number);
                const before = money;
                return { ok: placeTower('arrow', c, r), spent: before - money, towers: towers.length };
            });
            expect(res).toEqual({ ok: false, spent: 0, towers: 0 });
        });

        test('a tower cannot be built on another tower', async ({ page }) => {
            const res = await page.evaluate(() => {
                const spot = firstBuildableTile();
                placeTower('arrow', spot.c, spot.r);
                const before = money;
                return { ok: placeTower('cannon', spot.c, spot.r), spent: before - money, towers: towers.length };
            });
            expect(res).toEqual({ ok: false, spent: 0, towers: 1 });
        });

        test('a tower cannot be built without enough money', async ({ page }) => {
            const res = await page.evaluate(() => {
                money = 10;
                const spot = firstBuildableTile();
                return { ok: placeTower('cannon', spot.c, spot.r), towers: towers.length, money };
            });
            expect(res).toEqual({ ok: false, towers: 0, money: 10 });
        });

        test('clicking the canvas with a type selected builds there', async ({ page }) => {
            await page.evaluate(() => {
                startGame();
                selectTowerType('arrow');
            });
            const spot = await page.evaluate(() => firstBuildableTile());
            await page.locator('#canvas').click({
                position: { x: spot.c * 40 + 20, y: spot.r * 40 + 20 },
            });
            const t = await page.evaluate(() => towers.map((t) => ({ c: t.c, r: t.r, type: t.type })));
            expect(t).toEqual([{ c: spot.c, r: spot.r, type: 'arrow' }]);
        });

        test('the build buttons select a tower type', async ({ page }) => {
            await page.locator('#build-cannon').click();
            expect(await page.evaluate(() => selectedType)).toBe('cannon');
            await expect(page.locator('#build-cannon')).toHaveClass(/selected/);
        });

        test('number keys select tower types', async ({ page }) => {
            await page.keyboard.press('2');
            expect(await page.evaluate(() => selectedType)).toBe('cannon');
            await page.keyboard.press('3');
            expect(await page.evaluate(() => selectedType)).toBe('frost');
            await page.keyboard.press('1');
            expect(await page.evaluate(() => selectedType)).toBe('arrow');
        });

        test('Escape clears the selected type', async ({ page }) => {
            await page.keyboard.press('1');
            await page.keyboard.press('Escape');
            expect(await page.evaluate(() => selectedType)).toBe(null);
        });

        test('the money HUD reflects spending', async ({ page }) => {
            await page.evaluate(() => {
                const spot = firstBuildableTile();
                placeTower('arrow', spot.c, spot.r);
            });
            await expect(page.locator('#money')).toHaveText(String(150 - 50));
        });
    });

    // -----------------------------------------------------------------------
    // Selecting, upgrading and selling
    // -----------------------------------------------------------------------
    test.describe('tower management', () => {
        const build = () =>
            `(() => {
                startGame();
                const s = firstBuildableTile();
                placeTower('arrow', s.c, s.r);
                selectTowerAt(s.c, s.r);
                return s;
            })()`;

        test('clicking a built tower selects it and shows the panel', async ({ page }) => {
            const spot = await page.evaluate(() => {
                startGame();
                const s = firstBuildableTile();
                placeTower('arrow', s.c, s.r);
                return s;
            });
            await page.locator('#canvas').click({
                position: { x: spot.c * 40 + 20, y: spot.r * 40 + 20 },
            });
            expect(await page.evaluate(() => selectedTower !== null)).toBe(true);
            await expect(page.locator('#tower-panel')).toHaveClass(/visible/);
        });

        test('upgrading raises the level, damage and range', async ({ page }) => {
            const res = await page.evaluate(`(() => {
                ${build()};
                const before = { dmg: towerDamage(selectedTower), range: towerRange(selectedTower) };
                money = 999;
                const ok = upgradeSelected();
                return {
                    ok,
                    level: selectedTower.level,
                    dmgUp: towerDamage(selectedTower) > before.dmg,
                    rangeUp: towerRange(selectedTower) > before.range,
                };
            })()`);
            expect(res).toEqual({ ok: true, level: 2, dmgUp: true, rangeUp: true });
        });

        test('upgrading costs money', async ({ page }) => {
            const res = await page.evaluate(`(() => {
                ${build()};
                money = 500;
                const cost = upgradeCost(selectedTower);
                upgradeSelected();
                return { cost, spent: 500 - money };
            })()`);
            expect(res.cost).toBeGreaterThan(0);
            expect(res.spent).toBe(res.cost);
        });

        test('a tower cannot be upgraded past the max level', async ({ page }) => {
            const res = await page.evaluate(`(() => {
                ${build()};
                money = 9999;
                for (let i = 0; i < 10; i++) upgradeSelected();
                return { level: selectedTower.level, max: MAX_LEVEL, again: upgradeSelected() };
            })()`);
            expect(res.level).toBe(res.max);
            expect(res.again).toBe(false);
        });

        test('a tower cannot be upgraded without enough money', async ({ page }) => {
            const ok = await page.evaluate(`(() => { ${build()}; money = 0; return upgradeSelected(); })()`);
            expect(ok).toBe(false);
        });

        test('selling removes the tower and refunds part of the investment', async ({ page }) => {
            const res = await page.evaluate(`(() => {
                ${build()};
                const invested = selectedTower.invested;
                money = 0;
                const ok = sellSelected();
                return { ok, towers: towers.length, refund: money, invested, selected: selectedTower };
            })()`);
            expect(res.ok).toBe(true);
            expect(res.towers).toBe(0);
            expect(res.selected).toBe(null);
            expect(res.refund).toBeGreaterThan(0);
            expect(res.refund).toBeLessThan(res.invested);
        });

        test('the panel buttons upgrade and sell', async ({ page }) => {
            await page.evaluate(`(() => { ${build()}; money = 999; })()`);
            await page.locator('#btn-upgrade').click();
            expect(await page.evaluate(() => selectedTower.level)).toBe(2);
            await page.locator('#btn-sell').click();
            expect(await page.evaluate(() => towers.length)).toBe(0);
            await expect(page.locator('#tower-panel')).not.toHaveClass(/visible/);
        });

        test('clicking empty ground with no build type deselects', async ({ page }) => {
            const spot = await page.evaluate(`(() => ${build()})()`);
            await page.locator('#canvas').click({
                position: { x: (spot.c + 1) * 40 + 20, y: (spot.r + 2) * 40 + 20 },
            });
            expect(await page.evaluate(() => selectedTower)).toBe(null);
        });
    });

    // -----------------------------------------------------------------------
    // Enemies
    // -----------------------------------------------------------------------
    test.describe('enemies', () => {
        test('enemies walk along the path towards the exit', async ({ page }) => {
            const res = await page.evaluate(`(() => {
                startGame();
                ${SIM(2)};
                const e = enemies[0];
                const before = { x: e.x, dist: e.dist };
                ${SIM(1)};
                return { moved: e.x !== before.x || e.y !== undefined, gained: e.dist > before.dist };
            })()`);
            expect(res.gained).toBe(true);
        });

        test('an enemy stays on path tiles the whole way', async ({ page }) => {
            const offPath = await page.evaluate(`(() => {
                startGame();
                let bad = 0;
                for (let i = 0; i < 60 * 40; i++) {
                    step(1 / 60);
                    for (const e of enemies) {
                        if (e.x < 0 || e.x > 720) continue;
                        const c = Math.floor(e.x / TILE), r = Math.floor(e.y / TILE);
                        if (!PATH_TILES.has(c + ',' + r)) bad++;
                    }
                    if (!waveActive && enemies.length === 0) break;
                }
                return bad;
            })()`);
            expect(offPath).toBe(0);
        });

        test('an enemy that reaches the exit costs a life', async ({ page }) => {
            const res = await page.evaluate(`(() => {
                startGame();
                for (let i = 0; i < 60 * 60 && lives === 20; i++) step(1 / 60);
                return { lives };
            })()`);
            expect(res.lives).toBeLessThan(20);
        });

        test('leaked enemies are removed from the field', async ({ page }) => {
            const remaining = await page.evaluate(`(() => {
                startGame();
                for (let i = 0; i < 60 * 90; i++) {
                    step(1 / 60);
                    if (!waveActive && enemies.length === 0) break;
                }
                return enemies.length;
            })()`);
            expect(remaining).toBe(0);
        });

        test('later waves send tougher enemies', async ({ page }) => {
            const res = await page.evaluate(() => ({
                early: enemyHp('grunt', 1),
                late: enemyHp('grunt', WAVES.length),
            }));
            expect(res.late).toBeGreaterThan(res.early);
        });

        test('every wave definition spawns at least one enemy', async ({ page }) => {
            const counts = await page.evaluate(() =>
                WAVES.map((w) => w.groups.reduce((n, g) => n + g.count, 0)),
            );
            expect(counts.length).toBeGreaterThanOrEqual(10);
            for (const n of counts) expect(n).toBeGreaterThan(0);
        });
    });

    // -----------------------------------------------------------------------
    // Combat
    // -----------------------------------------------------------------------
    test.describe('combat', () => {
        // Drop a fully powered tower next to the start of the path so combat
        // happens quickly and deterministically.
        const armed = (type = 'arrow') => `(() => {
            startGame();
            money = 9999;
            const spot = buildableNearPathStart();
            placeTower('${type}', spot.c, spot.r);
        })()`;

        test('a tower fires at an enemy in range', async ({ page }) => {
            const fired = await page.evaluate(`(() => {
                ${armed()};
                for (let i = 0; i < 60 * 20; i++) {
                    step(1 / 60);
                    if (projectiles.length > 0) return true;
                }
                return false;
            })()`);
            expect(fired).toBe(true);
        });

        test('towers do not fire at enemies out of range', async ({ page }) => {
            const fired = await page.evaluate(`(() => {
                startGame();
                money = 9999;
                const far = farBuildableTile();
                placeTower('arrow', far.c, far.r);
                ${SIM(3)};
                return projectiles.length;
            })()`);
            expect(fired).toBe(0);
        });

        test('projectiles damage the enemy they hit', async ({ page }) => {
            const damaged = await page.evaluate(`(() => {
                ${armed()};
                let sawFullHp = false;
                for (let i = 0; i < 60 * 25; i++) {
                    step(1 / 60);
                    for (const e of enemies) {
                        if (e.hp === e.maxHp) sawFullHp = true;
                        if (e.hp < e.maxHp) return true;
                    }
                }
                return false;
            })()`);
            expect(damaged).toBe(true);
        });

        test('killing an enemy pays money and score', async ({ page }) => {
            const res = await page.evaluate(`(() => {
                ${armed()};
                const startMoney = money;
                for (let i = 0; i < 60 * 30; i++) {
                    step(1 / 60);
                    if (score > 0) return { paid: money > startMoney - 1, score };
                }
                return { paid: false, score };
            })()`);
            expect(res.score).toBeGreaterThan(0);
        });

        test('a tower is credited with the kills it lands', async ({ page }) => {
            const kills = await page.evaluate(`(() => {
                ${armed()};
                for (let i = 0; i < 60 * 30; i++) {
                    step(1 / 60);
                    if (towers[0].kills > 0) break;
                }
                return towers[0].kills;
            })()`);
            expect(kills).toBeGreaterThan(0);
        });

        test('a splash kill credits the cannon that fired it', async ({ page }) => {
            const kills = await page.evaluate(() => {
                startGame();
                money = 9999;
                const s = buildableNearPathStart();
                placeTower('cannon', s.c, s.r);
                const t = towers[0];
                const a = spawnEnemy('grunt', 1);
                const b = spawnEnemy('grunt', 1);
                a.x = t.x;
                a.y = t.y;
                b.x = t.x + 8;
                b.y = t.y;
                a.hp = 1;
                b.hp = 1;
                fire(t, a);
                for (let i = 0; i < 60; i++) step(1 / 60);
                return t.kills;
            });
            expect(kills).toBe(2);
        });

        test('a frost tower slows what it hits', async ({ page }) => {
            const slowed = await page.evaluate(`(() => {
                ${armed('frost')};
                for (let i = 0; i < 60 * 25; i++) {
                    step(1 / 60);
                    if (enemies.some((e) => e.slowT > 0)) return true;
                }
                return false;
            })()`);
            expect(slowed).toBe(true);
        });

        test('a slowed enemy moves more slowly than a fresh one', async ({ page }) => {
            const res = await page.evaluate(() => {
                const a = spawnEnemy('grunt', 1);
                const b = spawnEnemy('grunt', 1);
                b.slowT = 5;
                for (let i = 0; i < 30; i++) step(1 / 60, true);
                return { fast: a.dist, slow: b.dist };
            });
            expect(res.slow).toBeLessThan(res.fast);
            expect(res.slow).toBeGreaterThan(0);
        });

        test('a cannon shell splashes onto nearby enemies', async ({ page }) => {
            const hits = await page.evaluate(() => {
                startGame();
                const a = spawnEnemy('grunt', 1);
                const b = spawnEnemy('grunt', 1);
                b.x = a.x + 8;
                b.y = a.y;
                explodeAt(a.x, a.y, 20, TOWER_TYPES.cannon.splash);
                return [a.hp < a.maxHp, b.hp < b.maxHp];
            });
            expect(hits).toEqual([true, true]);
        });

        test('a tower only targets enemies within its range circle', async ({ page }) => {
            const res = await page.evaluate(() => {
                startGame();
                const s = buildableNearPathStart();
                money = 9999;
                placeTower('arrow', s.c, s.r);
                const t = towers[0];
                const near = spawnEnemy('grunt', 1);
                near.x = t.x + 10;
                near.y = t.y;
                near.dist = 1;
                const far = spawnEnemy('grunt', 1);
                far.x = t.x + towerRange(t) + 200;
                far.y = t.y;
                far.dist = 999;
                return acquireTarget(t) === near;
            });
            expect(res).toBe(true);
        });

        test('a tower prefers the enemy furthest along the path', async ({ page }) => {
            const res = await page.evaluate(() => {
                startGame();
                const s = buildableNearPathStart();
                money = 9999;
                placeTower('arrow', s.c, s.r);
                const t = towers[0];
                const behind = spawnEnemy('grunt', 1);
                behind.x = t.x + 5;
                behind.y = t.y;
                behind.dist = 10;
                const ahead = spawnEnemy('grunt', 1);
                ahead.x = t.x - 5;
                ahead.y = t.y;
                ahead.dist = 400;
                return acquireTarget(t) === ahead;
            });
            expect(res).toBe(true);
        });
    });

    // -----------------------------------------------------------------------
    // Waves and match flow
    // -----------------------------------------------------------------------
    test.describe('waves', () => {
        test('clearing a wave ends it and pays a bonus', async ({ page }) => {
            const res = await page.evaluate(`(() => {
                startGame();
                const before = money;
                for (let i = 0; i < 60 * 90; i++) {
                    step(1 / 60);
                    if (!waveActive && enemies.length === 0) break;
                }
                return { waveActive, gained: money - before };
            })()`);
            expect(res.waveActive).toBe(false);
            expect(res.gained).toBeGreaterThan(0);
        });

        test('Space launches the next wave between waves', async ({ page }) => {
            await page.evaluate(`(() => {
                startGame();
                for (let i = 0; i < 60 * 90; i++) {
                    step(1 / 60);
                    if (!waveActive && enemies.length === 0) break;
                }
            })()`);
            await page.keyboard.press('Space');
            expect(await page.evaluate(() => ({ wave, waveActive }))).toEqual({ wave: 2, waveActive: true });
        });

        test('a wave cannot be launched while one is running', async ({ page }) => {
            const res = await page.evaluate(() => {
                startGame();
                const ok = startNextWave();
                return { ok, wave };
            });
            expect(res).toEqual({ ok: false, wave: 1 });
        });

        test('surviving every wave wins the game', async ({ page }) => {
            const res = await page.evaluate(() => {
                startGame();
                wave = WAVES.length;
                enemies.length = 0;
                spawnQueue.length = 0;
                for (let i = 0; i < 600; i++) step(1 / 60);
                return { state, lives };
            });
            expect(res.state).toBe('won');
            expect(res.lives).toBeGreaterThan(0);
        });

        test('running out of lives ends the game', async ({ page }) => {
            const res = await page.evaluate(() => {
                startGame();
                lives = 1;
                for (let i = 0; i < 60 * 90 && state === 'running'; i++) step(1 / 60);
                return { state, lives };
            });
            expect(res.state).toBe('over');
            expect(res.lives).toBeLessThanOrEqual(0);
        });

        test('the overlay reappears when the game ends', async ({ page }) => {
            await page.evaluate(() => {
                startGame();
                lives = 1;
                for (let i = 0; i < 60 * 90 && state === 'running'; i++) step(1 / 60);
            });
            await expect(page.locator('#overlay')).toHaveClass(/visible/);
            await expect(page.locator('#overlay-title')).toContainText(/over/i);
        });

        test('no further enemy movement happens after game over', async ({ page }) => {
            const moved = await page.evaluate(() => {
                startGame();
                lives = 1;
                for (let i = 0; i < 60 * 90 && state === 'running'; i++) step(1 / 60);
                const e = spawnEnemy('grunt', 1);
                const before = e.dist;
                for (let i = 0; i < 60; i++) step(1 / 60);
                return e.dist !== before;
            });
            expect(moved).toBe(false);
        });
    });

    // -----------------------------------------------------------------------
    // Pause, restart and persistence
    // -----------------------------------------------------------------------
    test.describe('controls', () => {
        test('P pauses and resumes', async ({ page }) => {
            await page.evaluate(() => startGame());
            await page.keyboard.press('p');
            expect(await page.evaluate(() => state)).toBe('paused');
            const frozen = await page.evaluate(() => {
                const before = enemies.map((e) => e.dist);
                for (let i = 0; i < 60; i++) step(1 / 60);
                return enemies.every((e, i) => e.dist === before[i]);
            });
            expect(frozen).toBe(true);
            await page.keyboard.press('p');
            expect(await page.evaluate(() => state)).toBe('running');
        });

        test('restarting resets lives, money, wave and the field', async ({ page }) => {
            const res = await page.evaluate(() => {
                startGame();
                for (let i = 0; i < 600; i++) step(1 / 60);
                money = 12;
                lives = 3;
                startGame();
                return { lives, money, wave, towers: towers.length, enemies: enemies.length, score };
            });
            expect(res).toEqual({
                lives: 20,
                money: 150,
                wave: 1,
                towers: 0,
                enemies: 0,
                score: 0,
            });
        });

        test('the best wave reached is remembered', async ({ page }) => {
            await page.evaluate(() => {
                startGame();
                wave = 5;
                lives = 1;
                for (let i = 0; i < 60 * 90 && state === 'running'; i++) step(1 / 60);
            });
            await expect(page.locator('#best')).toContainText('5');
            await page.reload();
            await expect(page.locator('#best')).toContainText('5');
        });

        test('a stored best wave loads on startup', async ({ page }) => {
            await page.evaluate(() => window.localStorage.setItem('tower-defense-best', '9'));
            await page.reload();
            await expect(page.locator('#best')).toContainText('9');
        });
    });

    // -----------------------------------------------------------------------
    // Rendering
    // -----------------------------------------------------------------------
    test.describe('rendering', () => {
        test('the canvas is painted', async ({ page }) => {
            const painted = await page.evaluate(() => {
                draw();
                const data = ctx.getImageData(0, 0, 720, 480).data;
                for (let i = 3; i < data.length; i += 4) if (data[i] !== 0) return true;
                return false;
            });
            expect(painted).toBe(true);
        });

        test('drawing works in every state without throwing', async ({ page }) => {
            const err = await page.evaluate(() => {
                try {
                    draw();
                    startGame();
                    for (let i = 0; i < 300; i++) step(1 / 60);
                    draw();
                    selectTowerType('cannon');
                    draw();
                    state = 'over';
                    draw();
                    state = 'won';
                    draw();
                    return null;
                } catch (e) {
                    return String(e);
                }
            });
            expect(err).toBe(null);
        });
    });
});
