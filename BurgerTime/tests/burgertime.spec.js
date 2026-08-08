const { test, expect } = require('@playwright/test');
const path = require('path');
const { pathToFileURL } = require('url');

const GAME_URL = pathToFileURL(path.resolve(__dirname, '../index.html')).href;

// Advance the simulation a fixed number of 16 ms frames. Declared as a string
// helper because it runs inside the page, next to the game's globals.
const FRAMES = (n) => `for (let i = 0; i < ${n}; i++) step(0.016);`;

test.describe('Burger Time', () => {
    test.beforeEach(async ({ page }) => {
        await page.goto(GAME_URL);
    });

    // -----------------------------------------------------------------------
    // Initial / idle state
    // -----------------------------------------------------------------------
    test.describe('initial state', () => {
        test('page title is Burger Time', async ({ page }) => {
            await expect(page).toHaveTitle('Burger Time');
        });

        test('start overlay is visible', async ({ page }) => {
            await expect(page.locator('#overlay')).toHaveClass(/visible/);
        });

        test('overlay prompts the player to start', async ({ page }) => {
            await expect(page.locator('#overlay-sub')).toContainText(/space|start/i);
        });

        test('canvas is 640x600', async ({ page }) => {
            const canvas = page.locator('#canvas');
            await expect(canvas).toHaveAttribute('width', '640');
            await expect(canvas).toHaveAttribute('height', '600');
        });

        test('score, level, lives and pepper are shown in the HUD', async ({ page }) => {
            await expect(page.locator('#score')).toHaveText('0');
            await expect(page.locator('#level')).toHaveText('1');
            await expect(page.locator('#lives')).toHaveText('3');
            await expect(page.locator('#pepper')).toHaveText('5');
            await expect(page.locator('#best')).toHaveText('0');
        });

        test('state is idle before starting', async ({ page }) => {
            expect(await page.evaluate(() => state)).toBe('idle');
        });

        test('best score loads from localStorage', async ({ page }) => {
            await page.evaluate(() => window.localStorage.setItem('burgertime-best', '4200'));
            await page.reload();
            await expect(page.locator('#best')).toHaveText('4200');
        });
    });

    // -----------------------------------------------------------------------
    // Level layout
    // -----------------------------------------------------------------------
    test.describe('level layout', () => {
        test('there are four floors and four burger columns', async ({ page }) => {
            const layout = await page.evaluate(() => ({
                floors: FLOOR_Y.length,
                rows: FLOOR_ROWS,
                cols: BURGER_X.length,
            }));
            expect(layout.floors).toBe(4);
            expect(layout.rows).toBe(4);
            expect(layout.cols).toBe(4);
        });

        test('every burger column holds one layer per floor', async ({ page }) => {
            const grid = await page.evaluate(() => {
                startGame();
                const cells = [];
                for (let col = 0; col < BURGER_X.length; col++) {
                    for (let row = 0; row < FLOOR_ROWS; row++) {
                        cells.push(ingredientAt(col, row) ? 1 : 0);
                    }
                }
                return { cells, total: ingredients.length, expected: TOTAL_INGREDIENTS };
            });
            expect(grid.cells.every((c) => c === 1)).toBe(true);
            expect(grid.total).toBe(16);
            expect(grid.expected).toBe(16);
        });

        test('layers rest on top of their floor with no segments flipped', async ({ page }) => {
            const ing = await page.evaluate(() => {
                startGame();
                const i = ingredientAt(2, 1);
                return { y: i.y, expected: floorY(1) - ING_H, segs: i.segs, falling: i.falling };
            });
            expect(ing.y).toBe(ing.expected);
            expect(ing.segs).toEqual([false, false, false, false]);
            expect(ing.falling).toBe(false);
        });

        test('every ladder sits between burger columns, not inside one', async ({ page }) => {
            const clean = await page.evaluate(() =>
                LADDERS.every((l) => BURGER_X.every((x0) => l.x < x0 || l.x > x0 + ING_W)),
            );
            expect(clean).toBe(true);
        });

        test('ladderAt finds a ladder leading up out of the floor below it', async ({ page }) => {
            const found = await page.evaluate(() => {
                const l = LADDERS.find((x) => x.row === 2);
                return {
                    up: !!ladderAt(l.x, 3, -1),
                    down: !!ladderAt(l.x, 2, 1),
                    none: !!ladderAt(l.x, 0, -1),
                };
            });
            expect(found.up).toBe(true);
            expect(found.down).toBe(true);
            expect(found.none).toBe(false);
        });
    });

    // -----------------------------------------------------------------------
    // Starting
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

        test('a fresh game starts on level 1 with full lives and pepper', async ({ page }) => {
            const s = await page.evaluate(() => {
                startGame();
                return { level, lives, pepper, score };
            });
            expect(s.level).toBe(1);
            expect(s.lives).toBe(3);
            expect(s.pepper).toBe(5);
            expect(s.score).toBe(0);
        });

        test('the chef starts on the bottom floor', async ({ page }) => {
            const chef = await page.evaluate(() => {
                startGame();
                return { row: chef.row, y: chef.y, bottom: floorY(FLOOR_ROWS - 1), mode: chef.mode };
            });
            expect(chef.row).toBe(3);
            expect(chef.y).toBe(chef.bottom);
            expect(chef.mode).toBe('floor');
        });

        test('level 1 spawns two monsters', async ({ page }) => {
            const n = await page.evaluate(() => {
                startGame();
                return enemies.length;
            });
            expect(n).toBe(2);
        });
    });

    // -----------------------------------------------------------------------
    // Chef movement
    // -----------------------------------------------------------------------
    test.describe('chef movement', () => {
        test('walking right increases x', async ({ page }) => {
            const moved = await page.evaluate(() => {
                startGame();
                setChefPos(300, 3);
                const before = chef.x;
                setChefDir(1, 0);
                for (let i = 0; i < 10; i++) step(0.016);
                return chef.x > before;
            });
            expect(moved).toBe(true);
        });

        test('walking left decreases x', async ({ page }) => {
            const moved = await page.evaluate(() => {
                startGame();
                setChefPos(300, 3);
                const before = chef.x;
                setChefDir(-1, 0);
                for (let i = 0; i < 10; i++) step(0.016);
                return chef.x < before;
            });
            expect(moved).toBe(true);
        });

        test('the chef cannot walk off either edge', async ({ page }) => {
            const bounds = await page.evaluate(() => {
                startGame();
                setChefPos(300, 3);
                setChefDir(-1, 0);
                for (let i = 0; i < 600; i++) step(0.016);
                const left = chef.x;
                setChefDir(1, 0);
                for (let i = 0; i < 900; i++) step(0.016);
                return { left, right: chef.x, w: CANVAS_W };
            });
            expect(bounds.left).toBeGreaterThanOrEqual(0);
            expect(bounds.right).toBeLessThanOrEqual(bounds.w);
        });

        test('ArrowRight moves the chef right', async ({ page }) => {
            await page.evaluate(() => {
                startGame();
                setChefPos(300, 3);
            });
            const before = await page.evaluate(() => chef.x);
            await page.keyboard.down('ArrowRight');
            await page.evaluate(() => {
                for (let i = 0; i < 10; i++) step(0.016);
            });
            await page.keyboard.up('ArrowRight');
            expect(await page.evaluate(() => chef.x)).toBeGreaterThan(before);
        });

        test('pressing up at a ladder starts a climb', async ({ page }) => {
            const climbing = await page.evaluate(() => {
                startGame();
                const l = LADDERS.find((x) => x.row === 2);
                setChefPos(l.x, 3);
                setChefDir(0, -1);
                step(0.016);
                return { mode: chef.mode, x: chef.x, ladderX: l.x };
            });
            expect(climbing.mode).toBe('ladder');
            expect(climbing.x).toBe(climbing.ladderX);
        });

        test('climbing a full ladder lands the chef on the floor above', async ({ page }) => {
            const arrived = await page.evaluate(() => {
                startGame();
                const l = LADDERS.find((x) => x.row === 2);
                setChefPos(l.x, 3);
                setChefDir(0, -1);
                for (let i = 0; i < 200; i++) step(0.016);
                return { row: chef.row, mode: chef.mode, y: chef.y, floor: floorY(2) };
            });
            expect(arrived.row).toBe(2);
            expect(arrived.mode).toBe('floor');
            expect(arrived.y).toBe(arrived.floor);
        });

        test('climbing back down returns the chef to the lower floor', async ({ page }) => {
            const arrived = await page.evaluate(() => {
                startGame();
                const l = LADDERS.find((x) => x.row === 2);
                setChefPos(l.x, 2);
                setChefDir(0, 1);
                for (let i = 0; i < 200; i++) step(0.016);
                return { row: chef.row, mode: chef.mode };
            });
            expect(arrived.row).toBe(3);
            expect(arrived.mode).toBe('floor');
        });

        test('pressing up away from a ladder does nothing', async ({ page }) => {
            const stuck = await page.evaluate(() => {
                startGame();
                setChefPos(240, 3);
                setChefDir(0, -1);
                for (let i = 0; i < 60; i++) step(0.016);
                return { mode: chef.mode, row: chef.row };
            });
            expect(stuck.mode).toBe('floor');
            expect(stuck.row).toBe(3);
        });

        test('the chef cannot climb above the top floor', async ({ page }) => {
            const top = await page.evaluate(() => {
                startGame();
                const l = LADDERS.find((x) => x.row === 0);
                setChefPos(l.x, 0);
                setChefDir(0, -1);
                for (let i = 0; i < 120; i++) step(0.016);
                return { row: chef.row, mode: chef.mode, y: chef.y, floor: floorY(0) };
            });
            expect(top.row).toBe(0);
            expect(top.mode).toBe('floor');
            expect(top.y).toBe(top.floor);
        });

        test('the chef cannot climb below the bottom floor', async ({ page }) => {
            const bottom = await page.evaluate(() => {
                startGame();
                const l = LADDERS.find((x) => x.row === 2);
                setChefPos(l.x, 3);
                setChefDir(0, 1);
                for (let i = 0; i < 120; i++) step(0.016);
                return { row: chef.row, y: chef.y, floor: floorY(3) };
            });
            expect(bottom.row).toBe(3);
            expect(bottom.y).toBe(bottom.floor);
        });
    });

    // -----------------------------------------------------------------------
    // Flipping layers
    // -----------------------------------------------------------------------
    test.describe('flipping layers', () => {
        test('standing on a segment flips it', async ({ page }) => {
            const segs = await page.evaluate(() => {
                startGame();
                setChefPos(BURGER_X[0] + 12, 3);
                step(0.016);
                return ingredientAt(0, 3).segs;
            });
            expect(segs[0]).toBe(true);
            expect(segs[3]).toBe(false);
        });

        test('a layer on another floor is not flipped', async ({ page }) => {
            const segs = await page.evaluate(() => {
                startGame();
                setChefPos(BURGER_X[0] + 12, 3);
                step(0.016);
                return ingredientAt(0, 2).segs;
            });
            expect(segs).toEqual([false, false, false, false]);
        });

        test('walking the full width of a layer drops it', async ({ page }) => {
            const dropped = await page.evaluate(() => {
                startGame();
                const ing = ingredientAt(0, 3);
                setChefPos(BURGER_X[0] + 2, 3);
                setChefDir(1, 0);
                for (let i = 0; i < 90 && !ing.falling && !ing.plated; i++) step(0.016);
                return { segs: ing.segs, moving: ing.falling || ing.plated };
            });
            expect(dropped.segs.every(Boolean)).toBe(true);
            expect(dropped.moving).toBe(true);
        });

        test('a dropped layer falls downward', async ({ page }) => {
            const fall = await page.evaluate(() => {
                startGame();
                const ing = ingredientAt(0, 0);
                dropIngredient(ing);
                const before = ing.y;
                for (let i = 0; i < 5; i++) step(0.016);
                return { before, after: ing.y, falling: ing.falling };
            });
            expect(fall.after).toBeGreaterThan(fall.before);
            expect(fall.falling).toBe(true);
        });

        test('a layer landing on an empty floor rests there with segments reset', async ({ page }) => {
            const landed = await page.evaluate(() => {
                startGame();
                // clear the floor below so nothing gets bumped
                const below = ingredientAt(0, 1);
                ingredients.splice(ingredients.indexOf(below), 1);
                const ing = ingredientAt(0, 0);
                ing.segs = [true, true, true, false];
                dropIngredient(ing);
                for (let i = 0; i < 120 && ing.falling; i++) step(0.016);
                return { row: ing.row, y: ing.y, rest: floorY(1) - ING_H, segs: ing.segs, falling: ing.falling };
            });
            expect(landed.falling).toBe(false);
            expect(landed.row).toBe(1);
            expect(landed.y).toBe(landed.rest);
            expect(landed.segs).toEqual([false, false, false, false]);
        });

        test('a layer landing on an occupied floor bumps the occupant onward', async ({ page }) => {
            const bump = await page.evaluate(() => {
                startGame();
                const top = ingredientAt(0, 0);
                const below = ingredientAt(0, 1);
                dropIngredient(top);
                for (let i = 0; i < 120 && top.falling; i++) step(0.016);
                return { topRow: top.row, belowMoved: below.falling || below.row > 1 };
            });
            expect(bump.topRow).toBe(1);
            expect(bump.belowMoved).toBe(true);
        });

        test('a layer dropped from the bottom floor is plated', async ({ page }) => {
            const plate = await page.evaluate(() => {
                startGame();
                const ing = ingredientAt(1, 3);
                dropIngredient(ing);
                for (let i = 0; i < 200 && !ing.plated; i++) step(0.016);
                return { plated: ing.plated, falling: ing.falling, count: platedCount(1), other: platedCount(0) };
            });
            expect(plate.plated).toBe(true);
            expect(plate.falling).toBe(false);
            expect(plate.count).toBe(1);
            expect(plate.other).toBe(0);
        });

        test('plated layers stack on top of each other', async ({ page }) => {
            const stack = await page.evaluate(() => {
                startGame();
                const first = ingredientAt(1, 3);
                dropIngredient(first);
                for (let i = 0; i < 200 && !first.plated; i++) step(0.016);
                const second = ingredientAt(1, 2);
                second.row = 3;
                dropIngredient(second);
                for (let i = 0; i < 200 && !second.plated; i++) step(0.016);
                return { first: first.y, second: second.y, count: platedCount(1) };
            });
            expect(stack.count).toBe(2);
            expect(stack.second).toBeLessThan(stack.first);
        });

        test('flipping does not happen while the game is paused', async ({ page }) => {
            const segs = await page.evaluate(() => {
                startGame();
                togglePause();
                setChefPos(BURGER_X[0] + 12, 3);
                for (let i = 0; i < 20; i++) step(0.016);
                return ingredientAt(0, 3).segs;
            });
            expect(segs).toEqual([false, false, false, false]);
        });
    });

    // -----------------------------------------------------------------------
    // Monsters
    // -----------------------------------------------------------------------
    test.describe('monsters', () => {
        test('spawnEnemy places a monster at the given spot', async ({ page }) => {
            const e = await page.evaluate(() => {
                startGame();
                enemies.length = 0;
                const enemy = spawnEnemy({ x: 200, row: 1 });
                return { x: enemy.x, row: enemy.row, y: enemy.y, floor: floorY(1), count: enemies.length };
            });
            expect(e.count).toBe(1);
            expect(e.x).toBe(200);
            expect(e.row).toBe(1);
            expect(e.y).toBe(e.floor);
        });

        test('a monster on the chef\'s floor walks toward him', async ({ page }) => {
            const chase = await page.evaluate(() => {
                startGame();
                enemies.length = 0;
                setChefPos(500, 3);
                const e = spawnEnemy({ x: 100, row: 3 });
                const before = e.x;
                for (let i = 0; i < 30; i++) step(0.016);
                return { before, after: e.x };
            });
            expect(chase.after).toBeGreaterThan(chase.before);
        });

        test('a monster on another floor climbs toward the chef', async ({ page }) => {
            const climbed = await page.evaluate(() => {
                startGame();
                enemies.length = 0;
                setChefPos(320, 0);
                const e = spawnEnemy({ x: 300, row: 3 });
                for (let i = 0; i < 900; i++) step(0.016);
                return e.row < 3;
            });
            expect(climbed).toBe(true);
        });

        test('touching a monster costs a life and resets positions', async ({ page }) => {
            const hit = await page.evaluate(() => {
                startGame();
                enemies.length = 0;
                setChefPos(300, 3);
                spawnEnemy({ x: 300, row: 3 });
                step(0.016);
                return { lives, chefX: chef.x, spawnX: CHEF_SPAWN.x, state };
            });
            expect(hit.lives).toBe(2);
            expect(hit.chefX).toBe(hit.spawnX);
            expect(hit.state).toBe('running');
        });

        test('losing the last life ends the game', async ({ page }) => {
            const over = await page.evaluate(() => {
                startGame();
                lives = 1;
                enemies.length = 0;
                setChefPos(300, 3);
                spawnEnemy({ x: 300, row: 3 });
                step(0.016);
                return { state, lives };
            });
            expect(over.state).toBe('over');
            expect(over.lives).toBe(0);
        });

        test('a stunned monster does not move and cannot hurt the chef', async ({ page }) => {
            const safe = await page.evaluate(() => {
                startGame();
                enemies.length = 0;
                setChefPos(300, 3);
                const e = spawnEnemy({ x: 300, row: 3 });
                e.stun = 2;
                const before = e.x;
                for (let i = 0; i < 20; i++) step(0.016);
                return { lives, moved: Math.abs(e.x - before) };
            });
            expect(safe.lives).toBe(3);
            expect(safe.moved).toBe(0);
        });

        test('a stun wears off and the monster chases again', async ({ page }) => {
            const resumed = await page.evaluate(() => {
                startGame();
                enemies.length = 0;
                setChefPos(600, 3);
                const e = spawnEnemy({ x: 100, row: 3 });
                e.stun = 0.1;
                for (let i = 0; i < 6; i++) step(0.016);
                const during = e.x;
                for (let i = 0; i < 30; i++) step(0.016);
                return { during, after: e.x, start: 100 };
            });
            expect(resumed.during).toBe(resumed.start);
            expect(resumed.after).toBeGreaterThan(resumed.start);
        });

        test('spawn points are spread over more than one floor', async ({ page }) => {
            const rows = await page.evaluate(() => [...new Set(ENEMY_SPAWNS.map((s) => s.row))]);
            expect(rows.length).toBeGreaterThan(1);
        });

        test('a squashed monster comes back at its own spawn point', async ({ page }) => {
            const back = await page.evaluate(() => {
                startGame();
                enemies.length = 0;
                const e = spawnEnemy({ x: 300, row: 2, spawnIndex: 3 });
                killEnemy(e);
                // stop the moment it is back, before it can walk anywhere
                for (let i = 0; i < Math.ceil(RESPAWN_TIME / 0.016) + 5 && e.dead; i++) step(0.016);
                const spot = ENEMY_SPAWNS[3];
                return { x: e.x, row: e.row, spot };
            });
            expect(back.x).toBe(back.spot.x);
            expect(back.row).toBe(back.spot.row);
        });

        test('monsters split between two ladder habits so they do not clump', async ({ page }) => {
            const dirs = await page.evaluate(() => {
                startGame();
                enemies.length = 0;
                setChefPos(620, 3);
                const a = spawnEnemy({ x: 300, row: 2, spawnIndex: 0 });
                const b = spawnEnemy({ x: 300, row: 2, spawnIndex: 1 });
                for (let i = 0; i < 20; i++) step(0.016);
                return { a: Math.sign(a.x - 300), b: Math.sign(b.x - 300) };
            });
            // the even monster walks to the ladder nearest itself (x = 160),
            // the odd one to the ladder nearest the chef (x = 480)
            expect(dirs.a).toBe(-1);
            expect(dirs.b).toBe(1);
        });

        test('monsters are faster on later levels', async ({ page }) => {
            const speeds = await page.evaluate(() => {
                startGame();
                const l1 = enemySpeed();
                level = 4;
                return { l1, l4: enemySpeed() };
            });
            expect(speeds.l4).toBeGreaterThan(speeds.l1);
        });
    });

    // -----------------------------------------------------------------------
    // Pepper
    // -----------------------------------------------------------------------
    test.describe('pepper', () => {
        test('throwing pepper spends one shot and makes a cloud', async ({ page }) => {
            const shot = await page.evaluate(() => {
                startGame();
                setChefPos(300, 3);
                const ok = firePepper();
                return { ok, pepper, clouds: clouds.length };
            });
            expect(shot.ok).toBe(true);
            expect(shot.pepper).toBe(4);
            expect(shot.clouds).toBe(1);
        });

        test('pepper cannot be thrown with an empty shaker', async ({ page }) => {
            const shot = await page.evaluate(() => {
                startGame();
                pepper = 0;
                const ok = firePepper();
                return { ok, clouds: clouds.length };
            });
            expect(shot.ok).toBe(false);
            expect(shot.clouds).toBe(0);
        });

        test('pepper stuns a monster in front of the chef and scores', async ({ page }) => {
            const hit = await page.evaluate(() => {
                startGame();
                enemies.length = 0;
                score = 0;
                setChefPos(300, 3);
                setChefDir(1, 0);
                const e = spawnEnemy({ x: 330, row: 3 });
                firePepper();
                step(0.016);
                return { stun: e.stun, score };
            });
            expect(hit.stun).toBeGreaterThan(0);
            expect(hit.score).toBe(100);
        });

        test('pepper does not reach a monster behind the chef', async ({ page }) => {
            const miss = await page.evaluate(() => {
                startGame();
                enemies.length = 0;
                setChefPos(300, 3);
                setChefDir(1, 0);
                const e = spawnEnemy({ x: 200, row: 3 });
                firePepper();
                step(0.016);
                return e.stun;
            });
            expect(miss).toBe(0);
        });

        test('pepper clouds fade away', async ({ page }) => {
            const gone = await page.evaluate(() => {
                startGame();
                setChefPos(300, 3);
                firePepper();
                for (let i = 0; i < 60; i++) step(0.016);
                return clouds.length;
            });
            expect(gone).toBe(0);
        });

        test('the HUD shows the remaining pepper', async ({ page }) => {
            await page.evaluate(() => {
                startGame();
                firePepper();
            });
            await expect(page.locator('#pepper')).toHaveText('4');
        });

        test('the Space key throws pepper while playing', async ({ page }) => {
            await page.evaluate(() => {
                startGame();
                setChefPos(300, 3);
            });
            await page.keyboard.press('Space');
            expect(await page.evaluate(() => pepper)).toBe(4);
            expect(await page.evaluate(() => state)).toBe('running');
        });
    });

    // -----------------------------------------------------------------------
    // Squashing
    // -----------------------------------------------------------------------
    test.describe('squashing', () => {
        test('a falling layer squashes a monster underneath it', async ({ page }) => {
            const squash = await page.evaluate(() => {
                startGame();
                enemies.length = 0;
                score = 0;
                setChefPos(600, 3);
                const e = spawnEnemy({ x: BURGER_X[0] + ING_W / 2, row: 1 });
                const ing = ingredientAt(0, 0);
                dropIngredient(ing);
                for (let i = 0; i < 120 && !e.dead; i++) step(0.016);
                return { dead: e.dead, score };
            });
            expect(squash.dead).toBe(true);
            expect(squash.score).toBeGreaterThanOrEqual(500);
        });

        test('a squashed monster respawns after a delay', async ({ page }) => {
            const back = await page.evaluate(() => {
                startGame();
                enemies.length = 0;
                setChefPos(600, 3);
                const e = spawnEnemy({ x: BURGER_X[0] + ING_W / 2, row: 1 });
                const ing = ingredientAt(0, 0);
                dropIngredient(ing);
                for (let i = 0; i < 120 && !e.dead; i++) step(0.016);
                const wasDead = e.dead;
                for (let i = 0; i < Math.ceil(RESPAWN_TIME / 0.016) + 5; i++) step(0.016);
                return { wasDead, alive: !e.dead };
            });
            expect(back.wasDead).toBe(true);
            expect(back.alive).toBe(true);
        });

        test('a squashed monster cannot hurt the chef', async ({ page }) => {
            const safe = await page.evaluate(() => {
                startGame();
                enemies.length = 0;
                const e = spawnEnemy({ x: 300, row: 3 });
                e.dead = true;
                e.respawn = 5;
                setChefPos(300, 3);
                for (let i = 0; i < 20; i++) step(0.016);
                return lives;
            });
            expect(safe).toBe(3);
        });

        test('squashing two monsters with one layer pays a multiplier', async ({ page }) => {
            const score = await page.evaluate(() => {
                startGame();
                enemies.length = 0;
                score = 0;
                setChefPos(BURGER_X[0] + ING_W / 2, 3);
                spawnEnemy({ x: BURGER_X[0] + 40, row: 1 });
                spawnEnemy({ x: BURGER_X[0] + 80, row: 1 });
                const ing = ingredientAt(0, 0);
                dropIngredient(ing);
                for (let i = 0; i < 120; i++) step(0.016);
                return score;
            });
            expect(score).toBeGreaterThanOrEqual(1500);
        });
    });

    // -----------------------------------------------------------------------
    // Scoring & levels
    // -----------------------------------------------------------------------
    test.describe('scoring and levels', () => {
        test('a layer landing on a floor scores points', async ({ page }) => {
            const score = await page.evaluate(() => {
                startGame();
                score = 0;
                const below = ingredientAt(0, 1);
                ingredients.splice(ingredients.indexOf(below), 1);
                const ing = ingredientAt(0, 0);
                dropIngredient(ing);
                for (let i = 0; i < 120 && ing.falling; i++) step(0.016);
                return score;
            });
            expect(score).toBe(50);
        });

        test('plating a layer scores more than a floor landing', async ({ page }) => {
            const score = await page.evaluate(() => {
                startGame();
                score = 0;
                const ing = ingredientAt(2, 3);
                dropIngredient(ing);
                for (let i = 0; i < 200 && !ing.plated; i++) step(0.016);
                return score;
            });
            expect(score).toBe(150);
        });

        test('plating every layer clears the level', async ({ page }) => {
            const cleared = await page.evaluate(() => {
                startGame();
                const startLevel = level;
                for (let round = 0; round < 40 && level === startLevel; round++) {
                    // keep the kitchen monster-free so the run cannot end early
                    enemies.length = 0;
                    for (const ing of ingredients.slice()) {
                        if (!ing.plated && !ing.falling) dropIngredient(ing);
                    }
                    for (let i = 0; i < 200; i++) step(0.016);
                }
                return { level, plated: ingredients.filter((i) => i.plated).length, score };
            });
            expect(cleared.level).toBe(2);
            expect(cleared.plated).toBe(0);
            expect(cleared.score).toBeGreaterThan(1000);
        });

        test('clearing a level refills the pepper and adds a monster', async ({ page }) => {
            const next = await page.evaluate(() => {
                startGame();
                pepper = 1;
                nextLevel();
                return { level, pepper, monsters: enemies.length };
            });
            expect(next.level).toBe(2);
            expect(next.pepper).toBe(5);
            expect(next.monsters).toBe(3);
        });

        test('the monster count is capped', async ({ page }) => {
            const capped = await page.evaluate(() => {
                startGame();
                level = 12;
                buildEnemies();
                return enemies.length;
            });
            expect(capped).toBe(5);
        });

        test('the HUD tracks score and level', async ({ page }) => {
            await page.evaluate(() => {
                startGame();
                score = 777;
                level = 3;
                updateHud();
            });
            await expect(page.locator('#score')).toHaveText('777');
            await expect(page.locator('#level')).toHaveText('3');
        });

        test('best score is saved on game over', async ({ page }) => {
            await page.evaluate(() => {
                startGame();
                score = 2500;
                endGame();
            });
            await expect(page.locator('#best')).toHaveText('2500');
            const stored = await page.evaluate(() => window.localStorage.getItem('burgertime-best'));
            expect(parseInt(stored, 10)).toBe(2500);
        });

        test('best score is not lowered by a worse run', async ({ page }) => {
            await page.evaluate(() => window.localStorage.setItem('burgertime-best', '9999'));
            await page.reload();
            await page.evaluate(() => {
                startGame();
                score = 20;
                endGame();
            });
            await expect(page.locator('#best')).toHaveText('9999');
        });

        test('game over shows the overlay with Play Again', async ({ page }) => {
            await page.evaluate(() => {
                startGame();
                endGame();
            });
            await expect(page.locator('#overlay')).toHaveClass(/visible/);
            await expect(page.locator('#btn-start')).toHaveText('Play Again');
        });
    });

    // -----------------------------------------------------------------------
    // Pause & restart
    // -----------------------------------------------------------------------
    test.describe('pause and restart', () => {
        test('P pauses and resumes', async ({ page }) => {
            await page.evaluate(() => startGame());
            await page.keyboard.press('p');
            expect(await page.evaluate(() => state)).toBe('paused');
            await page.keyboard.press('p');
            expect(await page.evaluate(() => state)).toBe('running');
        });

        test('pausing freezes falling layers and monsters', async ({ page }) => {
            const frozen = await page.evaluate(() => {
                startGame();
                enemies.length = 0;
                setChefPos(500, 3);
                const e = spawnEnemy({ x: 100, row: 3 });
                const ing = ingredientAt(0, 0);
                dropIngredient(ing);
                togglePause();
                const y = ing.y;
                const x = e.x;
                for (let i = 0; i < 20; i++) step(0.016);
                return { ingMoved: ing.y - y, enemyMoved: e.x - x };
            });
            expect(frozen.ingMoved).toBe(0);
            expect(frozen.enemyMoved).toBe(0);
        });

        test('the pause overlay explains how to resume', async ({ page }) => {
            await page.evaluate(() => {
                startGame();
                togglePause();
            });
            await expect(page.locator('#overlay')).toHaveClass(/visible/);
            await expect(page.locator('#overlay-title')).toContainText(/paused/i);
        });

        test('restarting resets score, level, lives, layers and monsters', async ({ page }) => {
            const fresh = await page.evaluate(() => {
                startGame();
                score = 4000;
                level = 6;
                lives = 1;
                pepper = 0;
                dropIngredient(ingredientAt(0, 3));
                for (let i = 0; i < 200; i++) step(0.016);
                endGame();
                startGame();
                return {
                    score,
                    level,
                    lives,
                    pepper,
                    state,
                    layers: ingredients.length,
                    plated: ingredients.filter((i) => i.plated).length,
                    monsters: enemies.length,
                };
            });
            expect(fresh.score).toBe(0);
            expect(fresh.level).toBe(1);
            expect(fresh.lives).toBe(3);
            expect(fresh.pepper).toBe(5);
            expect(fresh.state).toBe('running');
            expect(fresh.layers).toBe(16);
            expect(fresh.plated).toBe(0);
            expect(fresh.monsters).toBe(2);
        });

        test('a long unattended session never throws', async ({ page }) => {
            const errors = [];
            page.on('pageerror', (e) => errors.push(String(e)));
            const after = await page.evaluate(() => {
                startGame();
                // two minutes of simulated time: monsters chase, layers fall,
                // lives are lost, the game ends and the board keeps drawing
                for (let i = 0; i < 7200; i++) {
                    step(0.016);
                    if (i % 60 === 0) draw();
                }
                return { state, lives };
            });
            expect(errors).toEqual([]);
            expect(['running', 'over']).toContain(after.state);
        });

        test('the simulation does not advance when the game is over', async ({ page }) => {
            const still = await page.evaluate(() => {
                startGame();
                setChefPos(300, 3);
                endGame();
                const x = chef.x;
                setChefDir(1, 0);
                for (let i = 0; i < 20; i++) step(0.016);
                return chef.x - x;
            });
            expect(still).toBe(0);
        });
    });
});
