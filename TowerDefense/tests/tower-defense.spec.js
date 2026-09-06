const { test, expect } = require('@playwright/test');
const path = require('path');
const { pathToFileURL } = require('url');

const GAME_URL = pathToFileURL(path.resolve(__dirname, '../index.html')).href;

// Helpers injected into the page for tests that need to reason about the map.
const HELPERS = `
    // Distance along the path (px) of the point closest to (x, y).
    function nearestDist(x, y) {
        let best = 0, bestD = Infinity;
        for (let d = 0; d <= pathLength; d += 2) {
            const p = pointAt(d);
            const dd = (p.x - x) * (p.x - x) + (p.y - y) * (p.y - y);
            if (dd < bestD) { bestD = dd; best = d; }
        }
        return best;
    }
    // A buildable cell that sits right next to the road, near the middle of the map.
    function findBuildSpot() {
        for (let r = 1; r < GRID_ROWS - 1; r++) {
            for (let c = 1; c < GRID_COLS - 1; c++) {
                if (!isBuildable(c, r)) continue;
                if (isOnPath(c + 1, r) || isOnPath(c - 1, r) ||
                    isOnPath(c, r + 1) || isOnPath(c, r - 1)) {
                    return { col: c, row: r };
                }
            }
        }
        return null;
    }
    // A road cell.
    function findRoadCell() {
        for (let r = 0; r < GRID_ROWS; r++) {
            for (let c = 0; c < GRID_COLS; c++) if (isOnPath(c, r)) return { col: c, row: r };
        }
        return null;
    }
    // Fresh game with plenty of gold and an empty board.
    function prep(g) {
        startGame();
        gold = g === undefined ? 1000 : g;
        creeps.length = 0;
        towers.length = 0;
        projectiles.length = 0;
    }
    // Build a tower next to the road and park a creep in front of it.
    function battle(type, creepOpts) {
        prep();
        const spot = findBuildSpot();
        const tower = placeTower(spot.col, spot.row, type);
        const c = cellCenter(spot.col, spot.row);
        const creep = spawnCreep(Object.assign(
            { dist: nearestDist(c.x, c.y), hp: 5000, speed: 0 }, creepOpts || {}));
        return { spot, tower, creep };
    }
    function run(seconds) { for (let i = 0; i < Math.round(seconds / 0.016); i++) step(0.016); }
`;

// Evaluate a body of statements in the page with HELPERS in scope.
const inPage = (body) => `(() => { ${HELPERS}\n${body} })()`;

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

        test('canvas is 640x480', async ({ page }) => {
            const canvas = page.locator('#canvas');
            await expect(canvas).toHaveAttribute('width', '640');
            await expect(canvas).toHaveAttribute('height', '480');
        });

        test('start overlay is visible and prompts the player', async ({ page }) => {
            await expect(page.locator('#overlay')).toHaveClass(/visible/);
            await expect(page.locator('#overlay-sub')).toContainText(/space|start/i);
        });

        test('HUD shows the starting gold, lives, wave and score', async ({ page }) => {
            await expect(page.locator('#gold')).toHaveText('100');
            await expect(page.locator('#lives')).toHaveText('20');
            await expect(page.locator('#wave')).toHaveText('1 / 10');
            await expect(page.locator('#score')).toHaveText('0');
        });

        test('state is idle with no creeps or towers', async ({ page }) => {
            const s = await page.evaluate(() => ({ state, creeps: creeps.length, towers: towers.length }));
            expect(s).toEqual({ state: 'idle', creeps: 0, towers: 0 });
        });

        test('best score loads from localStorage', async ({ page }) => {
            await page.evaluate(() => window.localStorage.setItem('tower-defense-best', '4242'));
            await page.reload();
            await expect(page.locator('#best')).toHaveText('4242');
        });

        test('the arrow tower is selected by default', async ({ page }) => {
            expect(await page.evaluate(() => selectedType)).toBe('arrow');
            await expect(page.locator('#tower-arrow')).toHaveClass(/selected/);
        });

        test('tower buttons show their cost', async ({ page }) => {
            await expect(page.locator('#tower-arrow')).toContainText('20');
            await expect(page.locator('#tower-cannon')).toContainText('45');
            await expect(page.locator('#tower-frost')).toContainText('35');
        });
    });

    // -----------------------------------------------------------------------
    // Map & path
    // -----------------------------------------------------------------------
    test.describe('map', () => {
        test('the path spans the map from left to right', async ({ page }) => {
            const info = await page.evaluate(() => ({
                cells: pathCells.size,
                length: pathLength,
                start: pointAt(0),
                end: pointAt(pathLength),
            }));
            expect(info.cells).toBeGreaterThan(40);
            expect(info.length).toBeGreaterThan(640);
            expect(info.start.x).toBeLessThan(0);
            expect(info.end.x).toBeGreaterThan(640 - 32);
        });

        test('road cells are not buildable', async ({ page }) => {
            const ok = await page.evaluate(inPage(`
                const road = findRoadCell();
                return isBuildable(road.col, road.row) === false;
            `));
            expect(ok).toBe(true);
        });

        test('grass cells next to the road are buildable', async ({ page }) => {
            const spot = await page.evaluate(inPage('return findBuildSpot();'));
            expect(spot).not.toBeNull();
        });

        test('cells outside the grid are not buildable', async ({ page }) => {
            const results = await page.evaluate(() => [
                isBuildable(-1, 3), isBuildable(3, -1),
                isBuildable(GRID_COLS, 3), isBuildable(3, GRID_ROWS),
            ]);
            expect(results).toEqual([false, false, false, false]);
        });

        test('pointAt walks monotonically left to right along the first leg', async ({ page }) => {
            const ok = await page.evaluate(() => {
                let prev = pointAt(0).x;
                for (let d = 0; d < 100; d += 10) {
                    const x = pointAt(d).x;
                    if (x < prev) return false;
                    prev = x;
                }
                return true;
            });
            expect(ok).toBe(true);
        });
    });

    // -----------------------------------------------------------------------
    // Starting the game
    // -----------------------------------------------------------------------
    test.describe('starting', () => {
        test('Space starts the game in the build phase', async ({ page }) => {
            await page.keyboard.press('Space');
            const s = await page.evaluate(() => ({ state, waveActive, wave }));
            expect(s).toEqual({ state: 'running', waveActive: false, wave: 1 });
        });

        test('the Start button starts the game and hides the overlay', async ({ page }) => {
            await page.locator('#btn-start').click();
            expect(await page.evaluate(() => state)).toBe('running');
            await expect(page.locator('#overlay')).not.toHaveClass(/visible/);
        });

        test('starting resets gold, lives and score', async ({ page }) => {
            const s = await page.evaluate(() => {
                gold = 5; lives = 2; score = 99;
                startGame();
                return { gold, lives, score, wave };
            });
            expect(s).toEqual({ gold: 100, lives: 20, score: 0, wave: 1 });
        });
    });

    // -----------------------------------------------------------------------
    // Building towers
    // -----------------------------------------------------------------------
    test.describe('building', () => {
        test('placing a tower spends gold and adds it to the board', async ({ page }) => {
            const r = await page.evaluate(inPage(`
                prep(100);
                const spot = findBuildSpot();
                const tower = placeTower(spot.col, spot.row, 'arrow');
                return { gold, towers: towers.length, type: tower && tower.type, level: tower && tower.level };
            `));
            expect(r).toEqual({ gold: 80, towers: 1, type: 'arrow', level: 1 });
        });

        test('a tower sits at the centre of its cell', async ({ page }) => {
            const r = await page.evaluate(inPage(`
                prep();
                const spot = findBuildSpot();
                const t = placeTower(spot.col, spot.row, 'arrow');
                const c = cellCenter(spot.col, spot.row);
                return { tx: t.x, ty: t.y, cx: c.x, cy: c.y };
            `));
            expect(r.tx).toBe(r.cx);
            expect(r.ty).toBe(r.cy);
        });

        test('towers cannot be built on the road', async ({ page }) => {
            const r = await page.evaluate(inPage(`
                prep();
                const road = findRoadCell();
                const before = gold;
                const t = placeTower(road.col, road.row, 'arrow');
                return { t, towers: towers.length, spent: before - gold };
            `));
            expect(r).toEqual({ t: null, towers: 0, spent: 0 });
        });

        test('two towers cannot share a cell', async ({ page }) => {
            const r = await page.evaluate(inPage(`
                prep();
                const spot = findBuildSpot();
                placeTower(spot.col, spot.row, 'arrow');
                const second = placeTower(spot.col, spot.row, 'cannon');
                return { second, towers: towers.length };
            `));
            expect(r).toEqual({ second: null, towers: 1 });
        });

        test('a tower cannot be built without enough gold', async ({ page }) => {
            const r = await page.evaluate(inPage(`
                prep(10);
                const spot = findBuildSpot();
                const t = placeTower(spot.col, spot.row, 'arrow');
                return { t, gold, towers: towers.length };
            `));
            expect(r).toEqual({ t: null, gold: 10, towers: 0 });
        });

        test('each tower type costs its listed price', async ({ page }) => {
            const costs = await page.evaluate(() => ({
                arrow: TOWER_TYPES.arrow.cost,
                cannon: TOWER_TYPES.cannon.cost,
                frost: TOWER_TYPES.frost.cost,
            }));
            expect(costs).toEqual({ arrow: 20, cannon: 45, frost: 35 });
        });

        test('keys 1, 2 and 3 select the tower type', async ({ page }) => {
            await page.keyboard.press('Space');
            await page.keyboard.press('2');
            expect(await page.evaluate(() => selectedType)).toBe('cannon');
            await expect(page.locator('#tower-cannon')).toHaveClass(/selected/);
            await page.keyboard.press('3');
            expect(await page.evaluate(() => selectedType)).toBe('frost');
            await page.keyboard.press('1');
            expect(await page.evaluate(() => selectedType)).toBe('arrow');
            await expect(page.locator('#tower-arrow')).toHaveClass(/selected/);
        });

        test('clicking a tower button selects that type', async ({ page }) => {
            await page.locator('#tower-cannon').click();
            expect(await page.evaluate(() => selectedType)).toBe('cannon');
            await expect(page.locator('#tower-arrow')).not.toHaveClass(/selected/);
        });

        test('clicking the canvas builds the selected tower there', async ({ page }) => {
            await page.keyboard.press('Space');
            const spot = await page.evaluate(inPage('return findBuildSpot();'));
            await page.locator('#canvas').click({
                position: { x: spot.col * 32 + 16, y: spot.row * 32 + 16 },
            });
            const r = await page.evaluate(([c, rw]) => {
                const t = towerAt(c, rw);
                return { count: towers.length, type: t && t.type };
            }, [spot.col, spot.row]);
            expect(r).toEqual({ count: 1, type: 'arrow' });
        });

        test('clicking the road builds nothing', async ({ page }) => {
            await page.keyboard.press('Space');
            const road = await page.evaluate(inPage('return findRoadCell();'));
            await page.locator('#canvas').click({
                position: { x: road.col * 32 + 16, y: road.row * 32 + 16 },
            });
            expect(await page.evaluate(() => towers.length)).toBe(0);
        });
    });

    // -----------------------------------------------------------------------
    // Upgrades
    // -----------------------------------------------------------------------
    test.describe('upgrades', () => {
        test('upgrading raises the level and spends gold', async ({ page }) => {
            const r = await page.evaluate(inPage(`
                prep(100);
                const spot = findBuildSpot();
                placeTower(spot.col, spot.row, 'arrow');
                const ok = upgradeTower(spot.col, spot.row);
                return { ok, level: towerAt(spot.col, spot.row).level, gold };
            `));
            expect(r).toEqual({ ok: true, level: 2, gold: 60 });
        });

        test('upgrading increases damage and range', async ({ page }) => {
            const r = await page.evaluate(inPage(`
                prep();
                const spot = findBuildSpot();
                const t = placeTower(spot.col, spot.row, 'arrow');
                const before = { d: towerDamage(t), r: towerRange(t) };
                upgradeTower(spot.col, spot.row);
                return { before, after: { d: towerDamage(t), r: towerRange(t) } };
            `));
            expect(r.after.d).toBeGreaterThan(r.before.d);
            expect(r.after.r).toBeGreaterThan(r.before.r);
        });

        test('towers stop at the maximum level', async ({ page }) => {
            const r = await page.evaluate(inPage(`
                prep();
                const spot = findBuildSpot();
                placeTower(spot.col, spot.row, 'arrow');
                upgradeTower(spot.col, spot.row);
                upgradeTower(spot.col, spot.row);
                const fourth = upgradeTower(spot.col, spot.row);
                return { level: towerAt(spot.col, spot.row).level, fourth, max: MAX_LEVEL };
            `));
            expect(r.level).toBe(3);
            expect(r.max).toBe(3);
            expect(r.fourth).toBe(false);
        });

        test('upgrading without gold fails', async ({ page }) => {
            const r = await page.evaluate(inPage(`
                prep(20);
                const spot = findBuildSpot();
                placeTower(spot.col, spot.row, 'arrow');
                const ok = upgradeTower(spot.col, spot.row);
                return { ok, level: towerAt(spot.col, spot.row).level, gold };
            `));
            expect(r).toEqual({ ok: false, level: 1, gold: 0 });
        });

        test('clicking an existing tower upgrades it', async ({ page }) => {
            await page.keyboard.press('Space');
            const spot = await page.evaluate(inPage('return findBuildSpot();'));
            const at = { x: spot.col * 32 + 16, y: spot.row * 32 + 16 };
            await page.locator('#canvas').click({ position: at });
            await page.locator('#canvas').click({ position: at });
            const r = await page.evaluate(([c, rw]) => ({ level: towerAt(c, rw).level, towers: towers.length }),
                [spot.col, spot.row]);
            expect(r).toEqual({ level: 2, towers: 1 });
        });
    });

    // -----------------------------------------------------------------------
    // Creeps
    // -----------------------------------------------------------------------
    test.describe('creeps', () => {
        test('spawnCreep places a creep at the start of the path', async ({ page }) => {
            const r = await page.evaluate(inPage(`
                prep();
                const c = spawnCreep({ hp: 30 });
                return { count: creeps.length, dist: c.dist, hp: c.hp, maxHp: c.maxHp };
            `));
            expect(r).toEqual({ count: 1, dist: 0, hp: 30, maxHp: 30 });
        });

        test('creeps advance along the path over time', async ({ page }) => {
            const r = await page.evaluate(inPage(`
                prep();
                const c = spawnCreep({ hp: 100, speed: 2 });
                const before = { dist: c.dist, x: c.x };
                run(1);
                return { before, after: { dist: c.dist, x: c.x } };
            `));
            expect(r.after.dist).toBeGreaterThan(r.before.dist);
            expect(r.after.x).toBeGreaterThan(r.before.x);
        });

        test('a creep that reaches the exit costs a life and leaves', async ({ page }) => {
            const r = await page.evaluate(inPage(`
                prep();
                spawnCreep({ hp: 100, dist: pathLength - 4 });
                const before = lives;
                run(1);
                return { before, after: lives, creeps: creeps.length };
            `));
            expect(r.after).toBe(r.before - 1);
            expect(r.creeps).toBe(0);
        });

        test('a boss that leaks costs more lives', async ({ page }) => {
            const cost = await page.evaluate(inPage(`
                prep();
                spawnCreep({ hp: 100, dist: pathLength - 4, boss: true });
                const before = lives;
                run(1);
                return before - lives;
            `));
            expect(cost).toBe(5);
        });

        test('killing a creep pays gold and score', async ({ page }) => {
            const r = await page.evaluate(inPage(`
                prep();
                const c = spawnCreep({ hp: 10, bounty: 7 });
                const g = gold, s = score;
                damageCreep(c, 50);
                return { gold: gold - g, score: score - s, creeps: creeps.length };
            `));
            expect(r).toEqual({ gold: 7, score: 7, creeps: 0 });
        });

        test('creep stats scale with the wave number', async ({ page }) => {
            const r = await page.evaluate(() => ({
                hp1: creepHp(1), hp5: creepHp(5),
                sp1: creepSpeed(1), sp5: creepSpeed(5),
                b1: creepBounty(1), b5: creepBounty(5),
            }));
            expect(r.hp5).toBeGreaterThan(r.hp1);
            expect(r.sp5).toBeGreaterThan(r.sp1);
            expect(r.b5).toBeGreaterThan(r.b1);
        });
    });

    // -----------------------------------------------------------------------
    // Combat
    // -----------------------------------------------------------------------
    test.describe('combat', () => {
        test('an arrow tower shoots a creep in range', async ({ page }) => {
            const r = await page.evaluate(inPage(`
                const { creep } = battle('arrow');
                const before = creep.hp;
                run(1.5);
                return { before, after: creep.hp };
            `));
            expect(r.after).toBeLessThan(r.before);
        });

        test('firing creates a projectile', async ({ page }) => {
            const seen = await page.evaluate(inPage(`
                battle('arrow');
                let seen = 0;
                for (let i = 0; i < 60; i++) { step(0.016); seen = Math.max(seen, projectiles.length); }
                return seen;
            `));
            expect(seen).toBeGreaterThan(0);
        });

        test('a creep outside a tower\'s range is not damaged', async ({ page }) => {
            const r = await page.evaluate(inPage(`
                prep();
                const spot = findBuildSpot();
                placeTower(spot.col, spot.row, 'arrow');
                const c = cellCenter(spot.col, spot.row);
                // Park the creep on the point of the path furthest from the tower.
                let far = 0, farD = -1;
                for (let d = 0; d <= pathLength; d += 4) {
                    const p = pointAt(d);
                    const dd = (p.x - c.x) * (p.x - c.x) + (p.y - c.y) * (p.y - c.y);
                    if (dd > farD) { farD = dd; far = d; }
                }
                const creep = spawnCreep({ dist: far, hp: 500, speed: 0 });
                const before = creep.hp;
                run(2);
                return { before, after: creep.hp, projectiles: projectiles.length };
            `));
            expect(r.after).toBe(r.before);
            expect(r.projectiles).toBe(0);
        });

        test('towers respect their cooldown', async ({ page }) => {
            const shots = await page.evaluate(inPage(`
                const { tower } = battle('arrow');
                run(2.05);
                return tower.shots;
            `));
            // 2.05s at a 0.5s cooldown is 5 shots (t=0, .5, 1, 1.5, 2).
            expect(shots).toBeGreaterThanOrEqual(4);
            expect(shots).toBeLessThanOrEqual(5);
        });

        test('an upgraded tower deals more damage per shot', async ({ page }) => {
            const r = await page.evaluate(inPage(`
                function trial(upgrade) {
                    const { spot, creep } = battle('arrow');
                    if (upgrade) upgradeTower(spot.col, spot.row);
                    run(1.2);
                    return 5000 - creep.hp;
                }
                return { plain: trial(false), upgraded: trial(true) };
            `));
            expect(r.upgraded).toBeGreaterThan(r.plain);
        });

        test('a frost tower slows its target', async ({ page }) => {
            const r = await page.evaluate(inPage(`
                const { creep } = battle('frost', { speed: 2 });
                run(1);
                return { slowTimer: creep.slowTimer, factor: SLOW_FACTOR };
            `));
            expect(r.slowTimer).toBeGreaterThan(0);
            expect(r.factor).toBeLessThan(1);
        });

        test('a slowed creep travels less far', async ({ page }) => {
            const r = await page.evaluate(inPage(`
                prep();
                const a = spawnCreep({ hp: 100, speed: 2 });
                const b = spawnCreep({ hp: 100, speed: 2 });
                b.slowTimer = 5;
                run(1);
                return { normal: a.dist, slowed: b.dist };
            `));
            expect(r.slowed).toBeLessThan(r.normal);
        });

        test('a cannon shell splashes onto nearby creeps', async ({ page }) => {
            const r = await page.evaluate(inPage(`
                prep();
                const spot = findBuildSpot();
                placeTower(spot.col, spot.row, 'cannon');
                const c = cellCenter(spot.col, spot.row);
                const d = nearestDist(c.x, c.y);
                const lead = spawnCreep({ dist: d + 6, hp: 5000, speed: 0 });
                const tail = spawnCreep({ dist: d - 6, hp: 5000, speed: 0 });
                run(1.2);
                return { lead: 5000 - lead.hp, tail: 5000 - tail.hp };
            `));
            expect(r.lead).toBeGreaterThan(0);
            expect(r.tail).toBeGreaterThan(0);
        });

        test('towers target the creep furthest along the path', async ({ page }) => {
            const r = await page.evaluate(inPage(`
                prep();
                const spot = findBuildSpot();
                placeTower(spot.col, spot.row, 'arrow');
                const c = cellCenter(spot.col, spot.row);
                const d = nearestDist(c.x, c.y);
                const behind = spawnCreep({ dist: d - 8, hp: 5000, speed: 0 });
                const ahead = spawnCreep({ dist: d + 8, hp: 5000, speed: 0 });
                run(0.6);
                return { ahead: 5000 - ahead.hp, behind: 5000 - behind.hp };
            `));
            expect(r.ahead).toBeGreaterThan(0);
            expect(r.behind).toBe(0);
        });
    });

    // -----------------------------------------------------------------------
    // Waves
    // -----------------------------------------------------------------------
    test.describe('waves', () => {
        test('the build phase waits for the player', async ({ page }) => {
            const r = await page.evaluate(inPage(`
                prep();
                run(3);
                return { waveActive, creeps: creeps.length };
            `));
            expect(r).toEqual({ waveActive: false, creeps: 0 });
        });

        test('startWave queues the wave and marks it active', async ({ page }) => {
            const r = await page.evaluate(inPage(`
                prep();
                startWave();
                return { waveActive, queued: spawnQueue.length, expected: creepCount(1) };
            `));
            expect(r.waveActive).toBe(true);
            expect(r.queued).toBe(r.expected);
            expect(r.queued).toBe(6);
        });

        test('Space sends the next wave', async ({ page }) => {
            await page.keyboard.press('Space');
            await page.keyboard.press('Space');
            expect(await page.evaluate(() => waveActive)).toBe(true);
        });

        test('the Send Wave button sends the wave', async ({ page }) => {
            await page.keyboard.press('Space');
            await page.locator('#btn-wave').click();
            expect(await page.evaluate(() => waveActive)).toBe(true);
        });

        test('creeps spawn from the queue over time', async ({ page }) => {
            const r = await page.evaluate(inPage(`
                prep();
                startWave();
                run(0.1);
                const first = creeps.length;
                run(1.5);
                return { first, later: creeps.length };
            `));
            expect(r.first).toBe(1);
            expect(r.later).toBeGreaterThan(1);
        });

        test('later waves send more and tougher creeps', async ({ page }) => {
            const r = await page.evaluate(() => ({ c1: creepCount(1), c4: creepCount(4) }));
            expect(r.c4).toBeGreaterThan(r.c1);
        });

        test('boss waves add a boss to the queue', async ({ page }) => {
            const r = await page.evaluate(inPage(`
                prep();
                wave = 5;
                startWave();
                return { bosses: spawnQueue.filter(c => c.boss).length, total: spawnQueue.length };
            `));
            expect(r.bosses).toBe(1);
            expect(r.total).toBe(15);
        });

        test('clearing a wave advances the wave and pays a bonus', async ({ page }) => {
            const r = await page.evaluate(inPage(`
                prep(0);
                startWave();
                spawnQueue.length = 0;
                creeps.length = 0;
                step(0.016);
                return { wave, waveActive, gold };
            `));
            expect(r.wave).toBe(2);
            expect(r.waveActive).toBe(false);
            expect(r.gold).toBeGreaterThan(0);
        });

        test('an unopposed wave leaks and costs lives', async ({ page }) => {
            const r = await page.evaluate(inPage(`
                prep();
                const before = lives;
                startWave();
                run(50);
                return { lost: before - lives, wave, waveActive };
            `));
            expect(r.lost).toBe(6);
            expect(r.wave).toBe(2);
            expect(r.waveActive).toBe(false);
        });
    });

    // -----------------------------------------------------------------------
    // Winning and losing
    // -----------------------------------------------------------------------
    test.describe('game over', () => {
        test('losing every life ends the game', async ({ page }) => {
            const r = await page.evaluate(inPage(`
                prep();
                lives = 1;
                spawnCreep({ hp: 100, dist: pathLength - 4 });
                run(1);
                return { state, lives };
            `));
            expect(r).toEqual({ state: 'over', lives: 0 });
            await expect(page.locator('#overlay')).toHaveClass(/visible/);
            await expect(page.locator('#overlay-title')).toContainText(/over|lost/i);
        });

        test('lives never go negative', async ({ page }) => {
            const lives = await page.evaluate(inPage(`
                prep();
                lives = 1;
                spawnCreep({ hp: 100, dist: pathLength - 4, boss: true });
                run(1);
                return lives;
            `));
            expect(lives).toBe(0);
        });

        test('clearing the final wave wins the game', async ({ page }) => {
            const r = await page.evaluate(inPage(`
                prep();
                wave = MAX_WAVES;
                startWave();
                spawnQueue.length = 0;
                creeps.length = 0;
                step(0.016);
                return { state, wave };
            `));
            expect(r.state).toBe('won');
            expect(r.wave).toBe(10);
            await expect(page.locator('#overlay-title')).toContainText(/victor|win|won/i);
        });

        test('surviving lives add to the final score on a win', async ({ page }) => {
            const r = await page.evaluate(inPage(`
                prep();
                wave = MAX_WAVES;
                score = 0;
                lives = 4;
                startWave();
                spawnQueue.length = 0;
                creeps.length = 0;
                step(0.016);
                return score;
            `));
            expect(r).toBeGreaterThanOrEqual(100);
        });

        test('the best score is stored in localStorage', async ({ page }) => {
            const stored = await page.evaluate(inPage(`
                prep();
                score = 777;
                lives = 1;
                spawnCreep({ hp: 100, dist: pathLength - 4 });
                run(1);
                return window.localStorage.getItem('tower-defense-best');
            `));
            expect(Number(stored)).toBeGreaterThanOrEqual(777);
        });

        test('a lower score does not overwrite the best', async ({ page }) => {
            await page.evaluate(() => window.localStorage.setItem('tower-defense-best', '9000'));
            await page.reload();
            const stored = await page.evaluate(inPage(`
                prep();
                score = 10;
                lives = 1;
                spawnCreep({ hp: 100, dist: pathLength - 4 });
                run(1);
                return window.localStorage.getItem('tower-defense-best');
            `));
            expect(stored).toBe('9000');
        });

        test('Space restarts after a loss', async ({ page }) => {
            await page.evaluate(inPage(`
                prep();
                lives = 1;
                spawnCreep({ hp: 100, dist: pathLength - 4 });
                run(1);
            `));
            await page.keyboard.press('Space');
            const s = await page.evaluate(() => ({ state, lives, wave }));
            expect(s).toEqual({ state: 'running', lives: 20, wave: 1 });
        });
    });

    // -----------------------------------------------------------------------
    // Pause & restart
    // -----------------------------------------------------------------------
    test.describe('pause and restart', () => {
        test('P pauses and resumes', async ({ page }) => {
            await page.keyboard.press('Space');
            await page.keyboard.press('p');
            expect(await page.evaluate(() => state)).toBe('paused');
            await expect(page.locator('#overlay')).toHaveClass(/visible/);
            await page.keyboard.press('p');
            expect(await page.evaluate(() => state)).toBe('running');
            await expect(page.locator('#overlay')).not.toHaveClass(/visible/);
        });

        test('a paused game does not advance', async ({ page }) => {
            const r = await page.evaluate(inPage(`
                prep();
                const c = spawnCreep({ hp: 100, speed: 2 });
                togglePause();
                const before = c.dist;
                run(1);
                return { before, after: c.dist, state };
            `));
            expect(r.state).toBe('paused');
            expect(r.after).toBe(r.before);
        });

        test('R restarts the game', async ({ page }) => {
            await page.keyboard.press('Space');
            await page.evaluate(inPage(`
                gold = 5;
                startWave();
                run(1);
            `));
            await page.keyboard.press('r');
            const s = await page.evaluate(() => ({ state, gold, creeps: creeps.length, waveActive }));
            expect(s).toEqual({ state: 'running', gold: 100, creeps: 0, waveActive: false });
        });
    });

    // -----------------------------------------------------------------------
    // HUD
    // -----------------------------------------------------------------------
    test.describe('HUD', () => {
        test('gold, lives and score update as the game runs', async ({ page }) => {
            await page.keyboard.press('Space');
            await page.evaluate(inPage(`
                const c = spawnCreep({ hp: 10, bounty: 12 });
                damageCreep(c, 50);
                lives = 17;
                step(0.016);
            `));
            await expect(page.locator('#gold')).toHaveText('112');
            await expect(page.locator('#score')).toHaveText('12');
            await expect(page.locator('#lives')).toHaveText('17');
        });

        test('the wave counter follows the current wave', async ({ page }) => {
            await page.keyboard.press('Space');
            await page.evaluate(inPage(`
                startWave();
                spawnQueue.length = 0;
                creeps.length = 0;
                step(0.016);
            `));
            await expect(page.locator('#wave')).toHaveText('2 / 10');
        });

        test('the Send Wave button is disabled while a wave is running', async ({ page }) => {
            await page.keyboard.press('Space');
            await expect(page.locator('#btn-wave')).toBeEnabled();
            await page.evaluate(() => { startWave(); updateHud(); });
            await expect(page.locator('#btn-wave')).toBeDisabled();
        });
    });

    // -----------------------------------------------------------------------
    // Rendering
    // -----------------------------------------------------------------------
    test.describe('rendering', () => {
        test('the canvas is painted', async ({ page }) => {
            const painted = await page.evaluate(() => {
                draw();
                const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
                for (let i = 0; i < data.length; i += 4) if (data[i + 3] > 0) return true;
                return false;
            });
            expect(painted).toBe(true);
        });

        test('drawing does not change game state', async ({ page }) => {
            const same = await page.evaluate(inPage(`
                prep();
                const c = spawnCreep({ hp: 50 });
                const snapshot = JSON.stringify([gold, lives, score, wave, c.dist, c.hp]);
                for (let i = 0; i < 5; i++) draw();
                return snapshot === JSON.stringify([gold, lives, score, wave, c.dist, c.hp]);
            `));
            expect(same).toBe(true);
        });

        test('hovering the canvas records the hovered cell', async ({ page }) => {
            await page.keyboard.press('Space');
            await page.locator('#canvas').hover({ position: { x: 100, y: 200 } });
            const h = await page.evaluate(() => ({ col: hover.col, row: hover.row }));
            expect(h).toEqual({ col: 3, row: 6 });
        });
    });
});
