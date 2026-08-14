const { test, expect } = require('@playwright/test');
const path = require('path');
const { pathToFileURL } = require('url');

const GAME_URL = pathToFileURL(path.resolve(__dirname, '../index.html')).href;

// Advance the simulation deterministically: `frames` calls to step(dt).
const advance = (page, frames, dt = 1 / 60) =>
    page.evaluate(([f, d]) => {
        for (let i = 0; i < f; i++) step(d);
    }, [frames, dt]);

// Start a run and land in the build phase.
const start = (page) => page.evaluate(() => startGame());

// Build a tower of `type` at a cell, ignoring cost.
const build = (page, type, col, row) =>
    page.evaluate(([t, c, r]) => {
        gold = 9999;
        selectTower(t);
        return placeTower(c, r);
    }, [type, col, row]);

// A grass cell next to the first straight of the road (row 2), and a road cell
// on that same straight.
const GRASS = { col: 10, row: 3 };
const ROAD = { col: 10, row: 2 };

test.describe('Tower Defense', () => {
    test.beforeEach(async ({ page }) => {
        await page.goto(GAME_URL);
    });

    // -----------------------------------------------------------------------
    // Initial / idle state
    // -----------------------------------------------------------------------
    test.describe('initial state', () => {
        test('page title is Tower Defense', async ({ page }) => {
            await expect(page).toHaveTitle('Tower Defense');
        });

        test('start overlay is visible', async ({ page }) => {
            await expect(page.locator('#overlay')).toHaveClass(/visible/);
        });

        test('overlay prompts the player to start', async ({ page }) => {
            await expect(page.locator('#overlay-sub')).toContainText(/space|start/i);
        });

        test('canvas is 560x420', async ({ page }) => {
            const canvas = page.locator('#canvas');
            await expect(canvas).toHaveAttribute('width', '560');
            await expect(canvas).toHaveAttribute('height', '420');
        });

        test('state is idle before starting', async ({ page }) => {
            expect(await page.evaluate(() => state)).toBe('idle');
        });

        test('HUD shows starting wave, lives, gold and score', async ({ page }) => {
            await expect(page.locator('#wave')).toHaveText('1');
            await expect(page.locator('#lives')).toHaveText('20');
            await expect(page.locator('#gold')).toHaveText('100');
            await expect(page.locator('#score')).toHaveText('0');
        });

        test('board starts with no towers, creeps or projectiles', async ({ page }) => {
            const counts = await page.evaluate(() => [
                towers.length,
                creeps.length,
                projectiles.length,
            ]);
            expect(counts).toEqual([0, 0, 0]);
        });

        test('the gun turret is selected by default', async ({ page }) => {
            expect(await page.evaluate(() => selected)).toBe('gun');
            await expect(page.locator('#tower-gun')).toHaveClass(/selected/);
        });

        test('each turret button shows its cost', async ({ page }) => {
            await expect(page.locator('#tower-gun')).toContainText('20');
            await expect(page.locator('#tower-frost')).toContainText('30');
            await expect(page.locator('#tower-cannon')).toContainText('45');
        });

        test('the simulation does not run while idle', async ({ page }) => {
            await page.evaluate(() => {
                creeps.push(spawnCreep('grunt'));
            });
            const before = await page.evaluate(() => creeps[0].dist);
            await advance(page, 60);
            expect(await page.evaluate(() => creeps[0].dist)).toBe(before);
        });
    });

    // -----------------------------------------------------------------------
    // Board geometry
    // -----------------------------------------------------------------------
    test.describe('board geometry', () => {
        test('the road runs from off the left edge to off the right edge', async ({ page }) => {
            const ends = await page.evaluate(() => [
                WAYPOINTS[0],
                WAYPOINTS[WAYPOINTS.length - 1],
            ]);
            expect(ends[0].col).toBeLessThan(0);
            expect(ends[1].col).toBeGreaterThan(19);
        });

        test('every waypoint pair shares a row or a column', async ({ page }) => {
            const straight = await page.evaluate(() =>
                WAYPOINTS.every((w, i) =>
                    i === 0 || w.col === WAYPOINTS[i - 1].col || w.row === WAYPOINTS[i - 1].row
                )
            );
            expect(straight).toBe(true);
        });

        test('pathPoints mirrors the waypoint list in pixels', async ({ page }) => {
            const [points, waypoints] = await page.evaluate(() => [
                pathPoints.length,
                WAYPOINTS.length,
            ]);
            expect(points).toBe(waypoints);
        });

        test('the road covers part of the board but leaves room to build', async ({ page }) => {
            const res = await page.evaluate(() => {
                let road = 0;
                for (let c = 0; c < COLS; c++)
                    for (let r = 0; r < ROWS; r++) if (isRoad(c, r)) road++;
                return { road, cells: COLS * ROWS };
            });
            expect(res.road).toBeGreaterThan(60);
            expect(res.road).toBeLessThan(res.cells / 2);
        });

        test('a cell on the road is not buildable', async ({ page }) => {
            const res = await page.evaluate(([c, r]) => [isRoad(c, r), isBuildable(c, r)], [
                ROAD.col,
                ROAD.row,
            ]);
            expect(res).toEqual([true, false]);
        });

        test('a grass cell is buildable', async ({ page }) => {
            const res = await page.evaluate(([c, r]) => [isRoad(c, r), isBuildable(c, r)], [
                GRASS.col,
                GRASS.row,
            ]);
            expect(res).toEqual([false, true]);
        });

        test('cells outside the grid are not buildable', async ({ page }) => {
            const res = await page.evaluate(() => [
                isBuildable(-1, 5),
                isBuildable(COLS, 5),
                isBuildable(5, -1),
                isBuildable(5, ROWS),
            ]);
            expect(res).toEqual([false, false, false, false]);
        });

        test('cellCenter returns the middle of the cell', async ({ page }) => {
            const c = await page.evaluate(() => cellCenter(0, 0));
            expect(c).toEqual({ x: 14, y: 14 });
        });
    });

    // -----------------------------------------------------------------------
    // Starting a run
    // -----------------------------------------------------------------------
    test.describe('starting a run', () => {
        test('Space starts the build phase', async ({ page }) => {
            await page.keyboard.press('Space');
            await expect.poll(() => page.evaluate(() => state)).toBe('building');
        });

        test('the start button starts the build phase', async ({ page }) => {
            await page.locator('#btn-start').click();
            await expect.poll(() => page.evaluate(() => state)).toBe('building');
        });

        test('the overlay hides once the run starts', async ({ page }) => {
            await start(page);
            await expect(page.locator('#overlay')).not.toHaveClass(/visible/);
        });

        test('starting resets gold, lives, wave, score and the board', async ({ page }) => {
            await page.evaluate(() => {
                startGame();
                gold = 3;
                lives = 2;
                wave = 7;
                score = 500;
                towers.push({});
                startGame();
            });
            const s = await page.evaluate(() => ({ gold, lives, wave, score, towers: towers.length }));
            expect(s).toEqual({ gold: 100, lives: 20, wave: 1, score: 0, towers: 0 });
        });

        test('the status line invites the player to send a wave', async ({ page }) => {
            await start(page);
            await expect(page.locator('#status')).toContainText(/wave/i);
        });
    });

    // -----------------------------------------------------------------------
    // Building, upgrading and selling
    // -----------------------------------------------------------------------
    test.describe('building', () => {
        test.beforeEach(async ({ page }) => start(page));

        test('a turret can be built on grass', async ({ page }) => {
            const ok = await page.evaluate(([c, r]) => placeTower(c, r), [GRASS.col, GRASS.row]);
            expect(ok).toBe(true);
            expect(await page.evaluate(() => towers.length)).toBe(1);
        });

        test('building deducts the turret cost', async ({ page }) => {
            await page.evaluate(([c, r]) => placeTower(c, r), [GRASS.col, GRASS.row]);
            expect(await page.evaluate(() => gold)).toBe(80);
            await expect(page.locator('#gold')).toHaveText('80');
        });

        test('a new turret starts at level 1 and records what it cost', async ({ page }) => {
            const t = await page.evaluate(([c, r]) => {
                placeTower(c, r);
                const t = towerAt(c, r);
                return { type: t.type, level: t.level, invested: t.invested };
            }, [GRASS.col, GRASS.row]);
            expect(t).toEqual({ type: 'gun', level: 1, invested: 20 });
        });

        test('a turret cannot be built on the road', async ({ page }) => {
            const ok = await page.evaluate(([c, r]) => placeTower(c, r), [ROAD.col, ROAD.row]);
            expect(ok).toBe(false);
            expect(await page.evaluate(() => [towers.length, gold])).toEqual([0, 100]);
        });

        test('a turret cannot be built on an occupied cell', async ({ page }) => {
            const ok = await page.evaluate(([c, r]) => {
                placeTower(c, r);
                return placeTower(c, r);
            }, [GRASS.col, GRASS.row]);
            expect(ok).toBe(false);
            expect(await page.evaluate(() => towers.length)).toBe(1);
        });

        test('a turret cannot be built without enough gold', async ({ page }) => {
            const ok = await page.evaluate(([c, r]) => {
                gold = 5;
                return placeTower(c, r);
            }, [GRASS.col, GRASS.row]);
            expect(ok).toBe(false);
            expect(await page.evaluate(() => [towers.length, gold])).toEqual([0, 5]);
        });

        test('a turret cannot be built before the run starts', async ({ page }) => {
            const ok = await page.evaluate(([c, r]) => {
                state = 'idle';
                return placeTower(c, r);
            }, [GRASS.col, GRASS.row]);
            expect(ok).toBe(false);
        });

        test('turrets can also be built during a wave', async ({ page }) => {
            const ok = await page.evaluate(([c, r]) => {
                callWave();
                return placeTower(c, r);
            }, [GRASS.col, GRASS.row]);
            expect(ok).toBe(true);
        });

        test('keys 1, 2 and 3 select the three turret types', async ({ page }) => {
            await page.keyboard.press('2');
            await expect.poll(() => page.evaluate(() => selected)).toBe('frost');
            await expect(page.locator('#tower-frost')).toHaveClass(/selected/);
            await page.keyboard.press('3');
            await expect.poll(() => page.evaluate(() => selected)).toBe('cannon');
            await page.keyboard.press('1');
            await expect.poll(() => page.evaluate(() => selected)).toBe('gun');
        });

        test('clicking a turret button selects that type', async ({ page }) => {
            await page.locator('#tower-cannon').click();
            expect(await page.evaluate(() => selected)).toBe('cannon');
            await expect(page.locator('#tower-cannon')).toHaveClass(/selected/);
            await expect(page.locator('#tower-gun')).not.toHaveClass(/selected/);
        });

        test('the selected type is what gets built, at its own cost', async ({ page }) => {
            const res = await page.evaluate(([c, r]) => {
                selectTower('cannon');
                placeTower(c, r);
                return { type: towerAt(c, r).type, gold };
            }, [GRASS.col, GRASS.row]);
            expect(res).toEqual({ type: 'cannon', gold: 55 });
        });
    });

    test.describe('upgrading and selling', () => {
        test.beforeEach(async ({ page }) => {
            await start(page);
            await build(page, 'gun', GRASS.col, GRASS.row);
        });

        test('upgrading raises the level and costs base cost times level', async ({ page }) => {
            const res = await page.evaluate(([c, r]) => {
                gold = 100;
                const ok = upgradeTower(c, r);
                const t = towerAt(c, r);
                return { ok, level: t.level, gold, invested: t.invested };
            }, [GRASS.col, GRASS.row]);
            expect(res).toEqual({ ok: true, level: 2, gold: 80, invested: 40 });
        });

        test('upgrading increases damage and range', async ({ page }) => {
            const res = await page.evaluate(([c, r]) => {
                const t = towerAt(c, r);
                const before = { d: towerDamage(t), r: towerRange(t) };
                gold = 999;
                upgradeTower(c, r);
                return { before, after: { d: towerDamage(t), r: towerRange(t) } };
            }, [GRASS.col, GRASS.row]);
            expect(res.after.d).toBeGreaterThan(res.before.d);
            expect(res.after.r).toBeGreaterThan(res.before.r);
        });

        test('a turret cannot go past level 3', async ({ page }) => {
            const res = await page.evaluate(([c, r]) => {
                gold = 9999;
                upgradeTower(c, r);
                upgradeTower(c, r);
                const ok = upgradeTower(c, r);
                return { ok, level: towerAt(c, r).level };
            }, [GRASS.col, GRASS.row]);
            expect(res).toEqual({ ok: false, level: 3 });
        });

        test('upgrading fails without enough gold', async ({ page }) => {
            const res = await page.evaluate(([c, r]) => {
                gold = 1;
                const ok = upgradeTower(c, r);
                return { ok, level: towerAt(c, r).level, gold };
            }, [GRASS.col, GRASS.row]);
            expect(res).toEqual({ ok: false, level: 1, gold: 1 });
        });

        test('upgrading an empty cell fails', async ({ page }) => {
            expect(await page.evaluate(() => upgradeTower(0, 0))).toBe(false);
        });

        test('selling removes the turret and refunds 60% of the investment', async ({ page }) => {
            const res = await page.evaluate(([c, r]) => {
                gold = 0;
                const ok = sellTower(c, r);
                return { ok, gold, towers: towers.length };
            }, [GRASS.col, GRASS.row]);
            expect(res).toEqual({ ok: true, gold: 12, towers: 0 });
        });

        test('selling an upgraded turret refunds 60% of everything spent', async ({ page }) => {
            const res = await page.evaluate(([c, r]) => {
                gold = 9999;
                upgradeTower(c, r);
                gold = 0;
                sellTower(c, r);
                return gold;
            }, [GRASS.col, GRASS.row]);
            expect(res).toBe(24);
        });

        test('selling an empty cell fails', async ({ page }) => {
            expect(await page.evaluate(() => sellTower(0, 0))).toBe(false);
        });
    });

    test.describe('mouse control', () => {
        test.beforeEach(async ({ page }) => start(page));

        // Click the middle of a given grid cell on the canvas.
        const clickCell = async (page, col, row, options = {}) => {
            const cell = await page.evaluate(() => CELL);
            await page.locator('#canvas').click({
                position: { x: col * cell + cell / 2, y: row * cell + cell / 2 },
                ...options,
            });
        };

        test('left-clicking grass builds the selected turret there', async ({ page }) => {
            await clickCell(page, GRASS.col, GRASS.row);
            const t = await page.evaluate(([c, r]) => {
                const t = towerAt(c, r);
                return t && { col: t.col, row: t.row, type: t.type };
            }, [GRASS.col, GRASS.row]);
            expect(t).toEqual({ col: GRASS.col, row: GRASS.row, type: 'gun' });
        });

        test('left-clicking the road builds nothing', async ({ page }) => {
            await clickCell(page, ROAD.col, ROAD.row);
            expect(await page.evaluate(() => towers.length)).toBe(0);
        });

        test('left-clicking your own turret upgrades it', async ({ page }) => {
            await clickCell(page, GRASS.col, GRASS.row);
            await clickCell(page, GRASS.col, GRASS.row);
            expect(
                await page.evaluate(([c, r]) => towerAt(c, r).level, [GRASS.col, GRASS.row])
            ).toBe(2);
        });

        test('right-clicking your own turret sells it', async ({ page }) => {
            await clickCell(page, GRASS.col, GRASS.row);
            await clickCell(page, GRASS.col, GRASS.row, { button: 'right' });
            expect(await page.evaluate(() => towers.length)).toBe(0);
        });
    });

    // -----------------------------------------------------------------------
    // Waves
    // -----------------------------------------------------------------------
    test.describe('waves', () => {
        test.beforeEach(async ({ page }) => start(page));

        test('calling a wave queues the whole wave and starts it running', async ({ page }) => {
            const res = await page.evaluate(() => {
                const ok = callWave();
                return { ok, state, queued: spawnQueue.length, composition: waveComposition(1).length };
            });
            expect(res.ok).toBe(true);
            expect(res.state).toBe('running');
            expect(res.queued).toBe(res.composition);
            expect(res.queued).toBeGreaterThan(0);
        });

        test('wave 1 is made of grunts only', async ({ page }) => {
            const types = await page.evaluate(() => [...new Set(waveComposition(1))]);
            expect(types).toEqual(['grunt']);
        });

        test('later waves introduce tougher creep types', async ({ page }) => {
            const res = await page.evaluate(() => ({
                all: [...new Set(WAVES.flatMap((_, i) => waveComposition(i + 1)))],
                waves: WAVES.length,
                last: waveComposition(WAVES.length),
            }));
            expect(res.waves).toBe(12);
            expect(res.all).toEqual(expect.arrayContaining(['grunt', 'runner', 'tank', 'boss']));
            expect(res.last).toContain('boss');
        });

        test('creep HP scales with the wave number', async ({ page }) => {
            const res = await page.evaluate(() => {
                wave = 1;
                const early = spawnCreep('grunt').maxHp;
                wave = 12;
                const late = spawnCreep('grunt').maxHp;
                return { early, late };
            });
            expect(res.late).toBeGreaterThan(res.early * 2);
        });

        test('a wave cannot be called while one is running', async ({ page }) => {
            const ok = await page.evaluate(() => {
                callWave();
                return callWave();
            });
            expect(ok).toBe(false);
        });

        test('Space sends the next wave during the build phase', async ({ page }) => {
            await page.keyboard.press('Space');
            await expect.poll(() => page.evaluate(() => state)).toBe('running');
        });

        test('the send-wave button sends the next wave', async ({ page }) => {
            await page.locator('#btn-wave').click();
            await expect.poll(() => page.evaluate(() => state)).toBe('running');
        });

        test('the first creep spawns immediately and the rest follow in order', async ({ page }) => {
            await page.evaluate(() => callWave());
            await advance(page, 1);
            expect(await page.evaluate(() => creeps.length)).toBe(1);
            await advance(page, Math.ceil(60 * 0.75));
            expect(await page.evaluate(() => creeps.length)).toBe(2);
        });

        test('creeps enter from the left edge and walk right', async ({ page }) => {
            await page.evaluate(() => callWave());
            await advance(page, 1);
            const first = await page.evaluate(() => ({ x: creeps[0].x, y: creeps[0].y }));
            await advance(page, 60);
            const later = await page.evaluate(() => ({ x: creeps[0].x, y: creeps[0].y }));
            expect(later.x).toBeGreaterThan(first.x);
            expect(later.y).toBe(first.y);
        });

        test('a creep follows the road round its first corner', async ({ page }) => {
            const res = await page.evaluate(() => {
                callWave();
                step(1 / 60);
                const c = creeps[0];
                // Walk it far enough to be past the first corner.
                for (let i = 0; i < 60 * 12; i++) step(1 / 60);
                return { seg: c.seg, x: c.x, y: c.y };
            });
            expect(res.seg).toBeGreaterThan(0);
            expect(res.y).toBeGreaterThan(70);
        });

        test('a creep that walks the whole road leaks and costs lives', async ({ page }) => {
            const res = await page.evaluate(() => {
                callWave();
                step(1 / 60); // let the first creep on, then stop the wave there
                spawnQueue.length = 0;
                for (let i = 0; i < 60 * 60; i++) step(1 / 60);
                return { lives, creeps: creeps.length, leaked };
            });
            expect(res.creeps).toBe(0);
            expect(res.lives).toBe(19);
            expect(res.leaked).toBe(1);
        });

        test('a cleared wave returns to the build phase and pays a bonus', async ({ page }) => {
            const res = await page.evaluate(() => {
                lives = 99;
                callWave();
                for (let i = 0; i < 60 * 90; i++) step(1 / 60);
                return { state, wave, gold, score };
            });
            expect(res.state).toBe('building');
            expect(res.wave).toBe(2);
            expect(res.gold).toBeGreaterThan(100);
            expect(res.score).toBeGreaterThan(0);
        });
    });

    // -----------------------------------------------------------------------
    // Combat
    // -----------------------------------------------------------------------
    test.describe('combat', () => {
        test.beforeEach(async ({ page }) => start(page));

        test('a turret in range fires at a creep', async ({ page }) => {
            await build(page, 'gun', GRASS.col, GRASS.row);
            const res = await page.evaluate(() => {
                callWave();
                for (let i = 0; i < 60 * 6; i++) step(1 / 60);
                return { fired: creeps.some((c) => c.hp < c.maxHp) || projectiles.length > 0 };
            });
            expect(res.fired).toBe(true);
        });

        test('a turret far from the road never fires', async ({ page }) => {
            await build(page, 'gun', 1, 14);
            const res = await page.evaluate(() => {
                callWave();
                let shots = 0;
                for (let i = 0; i < 60 * 20; i++) {
                    step(1 / 60);
                    shots += projectiles.length;
                }
                return { shots, damaged: creeps.some((c) => c.hp < c.maxHp) };
            });
            expect(res.shots).toBe(0);
            expect(res.damaged).toBe(false);
        });

        test('a gun turret kills a grunt and pays gold and score', async ({ page }) => {
            await build(page, 'gun', GRASS.col, GRASS.row);
            const res = await page.evaluate(() => {
                gold = 0;
                score = 0;
                callWave();
                // Stop as soon as the first creep dies, before any wave-clear bonus.
                let frames = 0;
                while (killed < 1 && frames < 60 * 20) {
                    step(1 / 60);
                    frames++;
                }
                return {
                    gold,
                    score,
                    killed,
                    lives,
                    seconds: frames / 60,
                    reward: CREEP_TYPES.grunt.reward,
                    points: CREEP_TYPES.grunt.points,
                };
            });
            expect(res.killed).toBe(1);
            expect(res.gold).toBe(res.reward);
            expect(res.score).toBe(res.points);
            expect(res.lives).toBe(20);
            expect(res.seconds).toBeLessThan(10);
        });

        test('a projectile disappears when it lands on its target', async ({ page }) => {
            await build(page, 'gun', GRASS.col, GRASS.row);
            const res = await page.evaluate(() => {
                callWave();
                let frames = 0;
                while (projectiles.length === 0 && frames < 60 * 20) {
                    step(1 / 60);
                    frames++;
                }
                const shot = projectiles[0];
                const target = shot.target;
                const hpBefore = target.hp;
                let flight = 0;
                while (projectiles.includes(shot) && flight < 60 * 2) {
                    step(1 / 60);
                    flight++;
                }
                return {
                    fired: !!shot,
                    landed: !projectiles.includes(shot),
                    hurt: target.hp < hpBefore || killed > 0,
                    flightSeconds: flight / 60,
                };
            });
            expect(res.fired).toBe(true);
            expect(res.landed).toBe(true);
            expect(res.hurt).toBe(true);
            expect(res.flightSeconds).toBeLessThan(1);
        });

        test('a turret shoots the creep furthest along the road', async ({ page }) => {
            await build(page, 'gun', GRASS.col, GRASS.row);
            const res = await page.evaluate(() => {
                const tower = towers[0];
                const behind = spawnCreep('grunt');
                const ahead = spawnCreep('grunt');
                behind.dist = 280;
                ahead.dist = 320;
                updateCreepPosition(behind);
                updateCreepPosition(ahead);
                creeps.push(behind, ahead);
                return {
                    inRange: [inTowerRange(tower, behind), inTowerRange(tower, ahead)],
                    targetsAhead: pickTarget(tower) === ahead,
                };
            });
            expect(res.inRange).toEqual([true, true]);
            expect(res.targetsAhead).toBe(true);
        });

        test('a turret ignores creeps that are out of range', async ({ page }) => {
            await build(page, 'gun', GRASS.col, GRASS.row);
            const res = await page.evaluate(() => {
                const far = spawnCreep('grunt');
                far.dist = 20;
                updateCreepPosition(far);
                creeps.push(far);
                return { inRange: inTowerRange(towers[0], far), target: pickTarget(towers[0]) };
            });
            expect(res.inRange).toBe(false);
            expect(res.target).toBeNull();
        });

        test('a frost turret slows the creeps it hits', async ({ page }) => {
            await build(page, 'frost', GRASS.col, GRASS.row);
            const res = await page.evaluate(() => {
                callWave();
                step(1 / 60); // let the first creep on, then stop the wave there
                spawnQueue.length = 0;
                for (let i = 0; i < 60 * 6; i++) step(1 / 60);
                const c = creeps[0];
                return { slow: c.slowTimer, speed: creepSpeed(c), base: CREEP_TYPES.grunt.speed };
            });
            expect(res.slow).toBeGreaterThan(0);
            expect(res.speed).toBeLessThan(res.base);
        });

        test('a frost slow wears off', async ({ page }) => {
            const res = await page.evaluate(() => {
                callWave();
                step(1 / 60); // let the first creep on, then stop the wave there
                spawnQueue.length = 0;
                const c = creeps[0];
                c.slowTimer = 0.5;
                for (let i = 0; i < 60; i++) step(1 / 60);
                return { slow: c.slowTimer, speed: creepSpeed(c) };
            });
            expect(res.slow).toBe(0);
            expect(res.speed).toBe(60);
        });

        test('a frost slow refreshes rather than stacking', async ({ page }) => {
            const res = await page.evaluate(() => {
                callWave();
                step(1 / 60); // let the first creep on, then stop the wave there
                spawnQueue.length = 0;
                const c = creeps[0];
                applySlow(c);
                const once = creepSpeed(c);
                applySlow(c);
                return { once, twice: creepSpeed(c), timer: c.slowTimer };
            });
            expect(res.twice).toBe(res.once);
            expect(res.timer).toBeGreaterThan(0);
        });

        test('a cannon shell splashes several creeps at once', async ({ page }) => {
            const res = await page.evaluate(() => {
                callWave();
                step(1 / 60); // let the first creep on, then stop the wave there
                spawnQueue.length = 0;
                const a = spawnCreep('grunt');
                const b = spawnCreep('grunt');
                a.dist = 300;
                b.dist = 310;
                creeps.push(a, b);
                updateCreepPosition(a);
                updateCreepPosition(b);
                detonate({ x: a.x, y: a.y, damage: 5, splash: 40 });
                return { a: a.hp < a.maxHp, b: b.hp < b.maxHp };
            });
            expect(res).toEqual({ a: true, b: true });
        });

        test('the turret types trade rate of fire, punch and utility', async ({ page }) => {
            const t = await page.evaluate(() => TOWER_TYPES);
            expect(t.gun.cooldown).toBeLessThan(t.cannon.cooldown);
            expect(t.cannon.damage).toBeGreaterThan(t.gun.damage);
            expect(t.cannon.cost).toBeGreaterThan(t.gun.cost);
            expect(t.cannon.splash).toBeGreaterThan(0);
            expect(t.frost.slow).toBeGreaterThan(0);
            expect(t.frost.slow).toBeLessThan(1);
        });

        test('an upgraded turret kills faster than a fresh one', async ({ page }) => {
            const timeToKill = (page, level) =>
                page.evaluate(
                    ([lvl, c, r]) => {
                        startGame();
                        gold = 9999;
                        selectTower('gun');
                        placeTower(c, r);
                        for (let i = 1; i < lvl; i++) upgradeTower(c, r);
                        callWave();
                        let frames = 0;
                        while (killed < 1 && frames < 60 * 40) {
                            step(1 / 60);
                            frames++;
                        }
                        return frames;
                    },
                    [level, GRASS.col, GRASS.row]
                );
            const slow = await timeToKill(page, 1);
            const fast = await timeToKill(page, 3);
            expect(fast).toBeLessThan(slow);
        });
    });

    // -----------------------------------------------------------------------
    // Losing and winning
    // -----------------------------------------------------------------------
    test.describe('losing', () => {
        test('running out of lives ends the run', async ({ page }) => {
            await start(page);
            const res = await page.evaluate(() => {
                lives = 1;
                callWave();
                step(1 / 60); // let the first creep on, then stop the wave there
                spawnQueue.length = 0;
                for (let i = 0; i < 60 * 60; i++) step(1 / 60);
                return { state, lives };
            });
            expect(res.state).toBe('over');
            expect(res.lives).toBe(0);
        });

        test('lives never fall below zero', async ({ page }) => {
            await start(page);
            const remaining = await page.evaluate(() => {
                lives = 1;
                callWave();
                step(1 / 60); // let the first creep on, then stop the wave there
                spawnQueue.length = 0;
                creeps[0].leak = 5;
                for (let i = 0; i < 60 * 60; i++) step(1 / 60);
                return lives;
            });
            expect(remaining).toBe(0);
        });

        test('the game over overlay shows the score', async ({ page }) => {
            await start(page);
            await page.evaluate(() => {
                score = 123;
                lives = 1;
                callWave();
                step(1 / 60); // let the first creep on, then stop the wave there
                spawnQueue.length = 0;
                for (let i = 0; i < 60 * 60; i++) step(1 / 60);
            });
            await expect(page.locator('#overlay')).toHaveClass(/visible/);
            await expect(page.locator('#overlay-title')).toContainText(/over|breach/i);
            await expect(page.locator('#overlay-score')).toContainText('123');
        });

        test('the simulation stops once the run is over', async ({ page }) => {
            await start(page);
            const before = await page.evaluate(() => {
                lives = 1;
                callWave();
                for (let i = 0; i < 60; i++) step(1 / 60);
                creeps[0].dist = 1e6; // walks off the end of the road next step
                step(1 / 60);
                return { state, creeps: creeps.length, queue: spawnQueue.length };
            });
            expect(before.state).toBe('over');
            expect(before.creeps).toBeGreaterThan(0);
            await advance(page, 120);
            const after = await page.evaluate(() => ({
                creeps: creeps.length,
                queue: spawnQueue.length,
            }));
            expect(after).toEqual({ creeps: before.creeps, queue: before.queue });
        });

        test('R restarts after a loss', async ({ page }) => {
            await start(page);
            await page.evaluate(() => {
                lives = 1;
                callWave();
                step(1 / 60); // let the first creep on, then stop the wave there
                spawnQueue.length = 0;
                for (let i = 0; i < 60 * 60; i++) step(1 / 60);
            });
            await page.keyboard.press('r');
            await expect.poll(() => page.evaluate(() => state)).toBe('building');
            expect(await page.evaluate(() => lives)).toBe(20);
        });

        test('the best score is remembered', async ({ page }) => {
            await start(page);
            await page.evaluate(() => {
                score = 777;
                lives = 1;
                callWave();
                step(1 / 60); // let the first creep on, then stop the wave there
                spawnQueue.length = 0;
                for (let i = 0; i < 60 * 60; i++) step(1 / 60);
            });
            await expect(page.locator('#best')).toHaveText('777');
            expect(await page.evaluate(() => localStorage.getItem('towerdefense-best'))).toBe('777');
        });
    });

    test.describe('winning', () => {
        test('surviving the last wave wins the run', async ({ page }) => {
            await start(page);
            const res = await page.evaluate(() => {
                wave = WAVES.length;
                lives = 99;
                callWave();
                for (let i = 0; i < 60 * 150; i++) step(1 / 60);
                return { state, lives };
            });
            expect(res.state).toBe('won');
            expect(res.lives).toBeGreaterThan(0);
        });

        test('the win overlay says so', async ({ page }) => {
            await start(page);
            await page.evaluate(() => {
                wave = WAVES.length;
                lives = 99;
                callWave();
                for (let i = 0; i < 60 * 150; i++) step(1 / 60);
            });
            await expect(page.locator('#overlay')).toHaveClass(/visible/);
            await expect(page.locator('#overlay-title')).toContainText(/win|clear|victor|defend/i);
        });
    });

    // -----------------------------------------------------------------------
    // Pausing
    // -----------------------------------------------------------------------
    test.describe('pausing', () => {
        test.beforeEach(async ({ page }) => start(page));

        test('P pauses a running wave', async ({ page }) => {
            await page.evaluate(() => callWave());
            await page.keyboard.press('p');
            await expect.poll(() => page.evaluate(() => state)).toBe('paused');
        });

        test('nothing moves while paused', async ({ page }) => {
            await page.evaluate(() => {
                callWave();
                step(1 / 60);
                togglePause();
            });
            const before = await page.evaluate(() => creeps[0].dist);
            await advance(page, 120);
            expect(await page.evaluate(() => creeps[0].dist)).toBe(before);
        });

        test('P resumes', async ({ page }) => {
            await page.evaluate(() => {
                callWave();
                step(1 / 60);
                togglePause();
            });
            await page.keyboard.press('p');
            await expect.poll(() => page.evaluate(() => state)).toBe('running');
            const before = await page.evaluate(() => creeps[0].dist);
            await advance(page, 60);
            expect(await page.evaluate(() => creeps[0].dist)).toBeGreaterThan(before);
        });

        test('the build phase cannot be paused', async ({ page }) => {
            await page.keyboard.press('p');
            expect(await page.evaluate(() => state)).toBe('building');
        });
    });

    // -----------------------------------------------------------------------
    // Rendering
    // -----------------------------------------------------------------------
    test.describe('rendering', () => {
        test('the board is drawn on the canvas', async ({ page }) => {
            const blank = await page.evaluate(() => {
                const c = document.createElement('canvas');
                c.width = canvas.width;
                c.height = canvas.height;
                return c.toDataURL();
            });
            const drawn = await page.evaluate(() => {
                draw();
                return canvas.toDataURL();
            });
            expect(drawn).not.toBe(blank);
        });

        test('drawing a running wave does not throw', async ({ page }) => {
            const err = await page.evaluate(() => {
                try {
                    startGame();
                    gold = 9999;
                    selectTower('cannon');
                    placeTower(10, 3);
                    selectTower('frost');
                    placeTower(11, 3);
                    callWave();
                    for (let i = 0; i < 60 * 5; i++) step(1 / 60);
                    draw();
                    return null;
                } catch (e) {
                    return String(e);
                }
            });
            expect(err).toBeNull();
        });
    });
});
