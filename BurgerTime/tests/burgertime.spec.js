const { test, expect } = require('@playwright/test');
const path = require('path');
const { pathToFileURL } = require('url');

const GAME_URL = pathToFileURL(path.resolve(__dirname, '../index.html')).href;

// Advance the simulation by `seconds` in small fixed slices. Every test drives
// the clock this way (with the requestAnimationFrame driver switched off via
// setAutoRun(false)) so results never depend on real frame timing.
const RUN = (seconds, dt = 0.016) =>
    `(() => { for (let i = 0; i < ${Math.round(seconds / dt)}; i++) step(${dt}); })()`;

test.describe('Burger Time', () => {
    test.beforeEach(async ({ page }) => {
        await page.goto(GAME_URL);
        // Deterministic tests: stop the rAF loop from stepping and pin the RNG.
        await page.evaluate(() => { setAutoRun(false); setSeed(1234); });
    });

    // -----------------------------------------------------------------------
    // Initial / idle state
    // -----------------------------------------------------------------------
    test.describe('initial state', () => {
        test('page title is Burger Time', async ({ page }) => {
            await expect(page).toHaveTitle('Burger Time');
        });

        test('canvas matches the level geometry', async ({ page }) => {
            const canvas = page.locator('#canvas');
            const size = await page.evaluate(() => ({ w: CANVAS_W, h: CANVAS_H }));
            await expect(canvas).toHaveAttribute('width', String(size.w));
            await expect(canvas).toHaveAttribute('height', String(size.h));
        });

        test('start overlay is visible and prompts the player', async ({ page }) => {
            await expect(page.locator('#overlay')).toHaveClass(/visible/);
            await expect(page.locator('#overlay-sub')).toContainText(/space|start/i);
        });

        test('HUD starts at score 0, 3 lives, level 1, 5 pepper', async ({ page }) => {
            await expect(page.locator('#score')).toHaveText('0');
            await expect(page.locator('#lives')).toHaveText('3');
            await expect(page.locator('#level')).toHaveText('1');
            await expect(page.locator('#pepper')).toHaveText('5');
        });

        test('state is idle before starting', async ({ page }) => {
            expect(await page.evaluate(() => state)).toBe('idle');
        });

        test('no enemies exist before starting', async ({ page }) => {
            expect(await page.evaluate(() => enemies.length)).toBe(0);
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
        test('there are four burger stacks of four ingredients each', async ({ page }) => {
            const info = await page.evaluate(() => ({
                total: ingredients.length,
                stacks: STACK_X.length,
                perBurger: INGREDIENTS_PER_BURGER,
                counts: STACK_X.map((_, k) => ingredients.filter((i) => i.stack === k).length),
            }));
            expect(info.stacks).toBe(4);
            expect(info.perBurger).toBe(4);
            expect(info.total).toBe(16);
            expect(info.counts).toEqual([4, 4, 4, 4]);
        });

        test('ingredients start stacked on the four upper floors', async ({ page }) => {
            const floors = await page.evaluate(() =>
                ingredients.filter((i) => i.stack === 0).map((i) => i.floor));
            expect(floors).toEqual([0, 1, 2, 3]);
        });

        test('every ingredient starts untrodden and resting', async ({ page }) => {
            const clean = await page.evaluate(() =>
                ingredients.every((i) => !i.falling && i.tiles.every((t) => !t)));
            expect(clean).toBe(true);
        });

        test('ingredients rest on their floor line', async ({ page }) => {
            const ok = await page.evaluate(() =>
                ingredients.every((i) => Math.abs(i.y + ITEM_H - FLOOR_Y[i.floor]) < 0.001));
            expect(ok).toBe(true);
        });

        test('there are five floors and five ladder columns', async ({ page }) => {
            const geo = await page.evaluate(() => ({ floors: FLOOR_Y.length, ladders: LADDER_X.length }));
            expect(geo.floors).toBe(5);
            expect(geo.ladders).toBe(5);
        });

        test('every ladder crossing is reachable from every other', async ({ page }) => {
            const reachable = await page.evaluate(() => {
                const dist = distancesFrom(0);
                return dist.every((d) => Number.isFinite(d));
            });
            expect(reachable).toBe(true);
        });

        test('each plate starts empty', async ({ page }) => {
            expect(await page.evaluate(() => plateCount)).toEqual([0, 0, 0, 0]);
        });
    });

    // -----------------------------------------------------------------------
    // Starting the game
    // -----------------------------------------------------------------------
    test.describe('starting', () => {
        test('Space starts the game and hides the overlay', async ({ page }) => {
            await page.keyboard.press('Space');
            expect(await page.evaluate(() => state)).toBe('running');
            await expect(page.locator('#overlay')).not.toHaveClass(/visible/);
        });

        test('the Start button starts the game', async ({ page }) => {
            await page.locator('#btn-start').click();
            expect(await page.evaluate(() => state)).toBe('running');
        });

        test('the chef starts on the bottom floor', async ({ page }) => {
            const c = await page.evaluate(() => {
                startGame();
                return { y: chef.y, bottom: FLOOR_Y[FLOOR_Y.length - 1], x: chef.x };
            });
            expect(c.y).toBe(c.bottom);
            expect(c.x).toBeGreaterThan(0);
        });

        test('enemies spawn when the game starts', async ({ page }) => {
            const n = await page.evaluate(() => { startGame(); return enemies.length; });
            expect(n).toBeGreaterThanOrEqual(2);
        });

        test('enemies spawn away from the chef', async ({ page }) => {
            const minDist = await page.evaluate(() => {
                startGame();
                return Math.min(...enemies.map((e) => Math.abs(e.x - chef.x) + Math.abs(e.y - chef.y)));
            });
            expect(minDist).toBeGreaterThan(100);
        });

        test('starting again resets a game in progress', async ({ page }) => {
            const r = await page.evaluate(() => {
                startGame();
                score = 900;
                lives = 1;
                level = 4;
                dropIngredient(ingredients[3]);
                startGame();
                return { score, lives, level, falling: ingredients.some((i) => i.falling) };
            });
            expect(r).toEqual({ score: 0, lives: 3, level: 1, falling: false });
        });
    });

    // -----------------------------------------------------------------------
    // Chef movement
    // -----------------------------------------------------------------------
    test.describe('chef movement', () => {
        test('walking right increases x', async ({ page }) => {
            const d = await page.evaluate(() => {
                startGame(); enemies.length = 0;
                const before = chef.x;
                setChefDir(1, 0);
                for (let i = 0; i < 20; i++) step(0.016);
                return { before, after: chef.x };
            });
            expect(d.after).toBeGreaterThan(d.before);
        });

        test('walking left decreases x', async ({ page }) => {
            const d = await page.evaluate(() => {
                startGame(); enemies.length = 0;
                const before = chef.x;
                setChefDir(-1, 0);
                for (let i = 0; i < 20; i++) step(0.016);
                return { before, after: chef.x };
            });
            expect(d.after).toBeLessThan(d.before);
        });

        test('the chef cannot walk off the left edge', async ({ page }) => {
            const x = await page.evaluate(() => {
                startGame(); enemies.length = 0;
                setChefDir(-1, 0);
                for (let i = 0; i < 800; i++) step(0.016);
                return chef.x;
            });
            expect(x).toBeGreaterThanOrEqual(0);
        });

        test('the chef cannot walk off the right edge', async ({ page }) => {
            const r = await page.evaluate(() => {
                startGame(); enemies.length = 0;
                setChefDir(1, 0);
                for (let i = 0; i < 800; i++) step(0.016);
                return { x: chef.x, w: CANVAS_W };
            });
            expect(r.x).toBeLessThanOrEqual(r.w);
        });

        test('ArrowRight key moves the chef right', async ({ page }) => {
            await page.evaluate(() => { startGame(); enemies.length = 0; });
            const before = await page.evaluate(() => chef.x);
            await page.keyboard.down('ArrowRight');
            await page.evaluate(RUN(0.4));
            await page.keyboard.up('ArrowRight');
            expect(await page.evaluate(() => chef.x)).toBeGreaterThan(before);
        });

        test('releasing the key stops the chef', async ({ page }) => {
            await page.evaluate(() => { startGame(); enemies.length = 0; });
            await page.keyboard.down('ArrowRight');
            await page.evaluate(RUN(0.2));
            await page.keyboard.up('ArrowRight');
            const x = await page.evaluate(() => chef.x);
            await page.evaluate(RUN(0.4));
            expect(await page.evaluate(() => chef.x)).toBe(x);
        });

        test('climbing up a ladder decreases y and snaps x to the ladder', async ({ page }) => {
            const r = await page.evaluate(() => {
                startGame(); enemies.length = 0;
                setChefPos(LADDER_X[2] + 3, FLOOR_Y[4]);
                const before = chef.y;
                setChefDir(0, -1);
                for (let i = 0; i < 20; i++) step(0.016);
                return { before, after: chef.y, x: chef.x, ladder: LADDER_X[2] };
            });
            expect(r.after).toBeLessThan(r.before);
            expect(r.x).toBeCloseTo(r.ladder, 5);
        });

        test('pressing up away from a ladder does nothing', async ({ page }) => {
            const r = await page.evaluate(() => {
                startGame(); enemies.length = 0;
                const midX = (LADDER_X[1] + LADDER_X[2]) / 2;
                setChefPos(midX, FLOOR_Y[4]);
                const before = chef.y;
                setChefDir(0, -1);
                for (let i = 0; i < 20; i++) step(0.016);
                return { before, after: chef.y };
            });
            expect(r.after).toBe(r.before);
        });

        test('climbing stops at the floor above', async ({ page }) => {
            const r = await page.evaluate(() => {
                startGame(); enemies.length = 0;
                setChefPos(LADDER_X[1], FLOOR_Y[4]);
                setChefDir(0, -1);
                for (let i = 0; i < 400; i++) step(0.016);
                return { y: chef.y, target: FLOOR_Y[3] };
            });
            expect(r.y).toBe(r.target);
        });

        test('the chef cannot climb where no ladder reaches', async ({ page }) => {
            // Ladder column 0 has no rung between the bottom two floors.
            const r = await page.evaluate(() => {
                startGame(); enemies.length = 0;
                setChefPos(LADDER_X[0], FLOOR_Y[4]);
                const before = chef.y;
                setChefDir(0, -1);
                for (let i = 0; i < 20; i++) step(0.016);
                return { before, after: chef.y, hasLadder: LADDER_SEGS[3].includes(0) };
            });
            expect(r.hasLadder).toBe(false);
            expect(r.after).toBe(r.before);
        });

        test('horizontal input is ignored between floors', async ({ page }) => {
            const r = await page.evaluate(() => {
                startGame(); enemies.length = 0;
                setChefPos(LADDER_X[2], FLOOR_Y[4]);
                setChefDir(0, -1);
                for (let i = 0; i < 10; i++) step(0.016);   // part-way up the ladder
                const x = chef.x;
                const midAir = floorIndexAt(chef.y) === -1;
                setChefDir(1, 0);
                for (let i = 0; i < 20; i++) step(0.016);
                return { x, after: chef.x, midAir };
            });
            expect(r.midAir).toBe(true);
            expect(r.after).toBeCloseTo(r.x, 5);
        });

        test('the chef can climb back down', async ({ page }) => {
            const r = await page.evaluate(() => {
                startGame(); enemies.length = 0;
                setChefPos(LADDER_X[1], FLOOR_Y[3]);
                setChefDir(0, 1);
                for (let i = 0; i < 400; i++) step(0.016);
                return { y: chef.y, target: FLOOR_Y[4] };
            });
            expect(r.y).toBe(r.target);
        });
    });

    // -----------------------------------------------------------------------
    // Ingredients: treading, falling, stacking
    // -----------------------------------------------------------------------
    test.describe('ingredients', () => {
        test('walking over a tile marks it as trodden', async ({ page }) => {
            const tiles = await page.evaluate(() => {
                startGame(); enemies.length = 0;
                const ing = ingredients.find((i) => i.stack === 1 && i.floor === 3);
                setChefPos(ing.x + TILE / 2, FLOOR_Y[3]);
                step(0.016);
                return ing.tiles.slice();
            });
            expect(tiles[0]).toBe(true);
            expect(tiles[3]).toBe(false);
        });

        test('a partly trodden ingredient does not fall', async ({ page }) => {
            const r = await page.evaluate(() => {
                startGame(); enemies.length = 0;
                const ing = ingredients.find((i) => i.stack === 1 && i.floor === 3);
                setChefPos(ing.x + TILE / 2, FLOOR_Y[3]);
                setChefDir(1, 0);
                for (let i = 0; i < 15; i++) step(0.016);
                return { falling: ing.falling, floor: ing.floor };
            });
            expect(r.falling).toBe(false);
            expect(r.floor).toBe(3);
        });

        test('walking across all four tiles drops the ingredient', async ({ page }) => {
            const r = await page.evaluate(() => {
                startGame(); enemies.length = 0;
                const ing = ingredients.find((i) => i.stack === 1 && i.floor === 3);
                setChefPos(ing.x - 2, FLOOR_Y[3]);
                setChefDir(1, 0);
                for (let i = 0; i < 200 && !ing.falling; i++) step(0.016);
                return { falling: ing.falling, tiles: ing.tiles.slice() };
            });
            expect(r.falling).toBe(true);
        });

        test('ingredients on other floors are untouched by the walk', async ({ page }) => {
            const untouched = await page.evaluate(() => {
                startGame(); enemies.length = 0;
                setChefPos(0, FLOOR_Y[3]);
                setChefDir(1, 0);
                for (let i = 0; i < 60; i++) step(0.016);
                return ingredients
                    .filter((i) => i.floor !== 3)
                    .every((i) => i.tiles.every((t) => !t));
            });
            expect(untouched).toBe(true);
        });

        test('dropping an ingredient scores points', async ({ page }) => {
            const r = await page.evaluate(() => {
                startGame(); enemies.length = 0;
                const before = score;
                dropIngredient(ingredients.find((i) => i.stack === 0 && i.floor === 3));
                return { before, after: score, points: DROP_SCORE };
            });
            expect(r.points).toBeGreaterThan(0);
            expect(r.after).toBe(r.before + r.points);
        });

        test('a falling ingredient moves downward', async ({ page }) => {
            const r = await page.evaluate(() => {
                startGame(); enemies.length = 0;
                const ing = ingredients.find((i) => i.stack === 0 && i.floor === 0);
                dropIngredient(ing);
                const before = ing.y;
                for (let i = 0; i < 5; i++) step(0.016);
                return { before, after: ing.y };
            });
            expect(r.after).toBeGreaterThan(r.before);
        });

        test('a falling ingredient lands on the next floor down', async ({ page }) => {
            const r = await page.evaluate(() => {
                startGame(); enemies.length = 0;
                const ing = ingredients.find((i) => i.stack === 0 && i.floor === 2);
                const below = ingredients.find((i) => i.stack === 0 && i.floor === 3);
                below.floor = -1;                     // park it out of the way
                dropIngredient(ing);
                for (let i = 0; i < 300 && ing.falling; i++) step(0.016);
                return { floor: ing.floor, falling: ing.falling, y: ing.y, expect: FLOOR_Y[3] - ITEM_H };
            });
            expect(r.falling).toBe(false);
            expect(r.floor).toBe(3);
            expect(r.y).toBeCloseTo(r.expect, 5);
        });

        test('landing on a resting ingredient pushes it down too', async ({ page }) => {
            const r = await page.evaluate(() => {
                startGame(); enemies.length = 0;
                const top = ingredients.find((i) => i.stack === 2 && i.floor === 2);
                const below = ingredients.find((i) => i.stack === 2 && i.floor === 3);
                dropIngredient(top);
                for (let i = 0; i < 300 && !below.falling; i++) step(0.016);
                return { belowFalling: below.falling };
            });
            expect(r.belowFalling).toBe(true);
        });

        test('an ingredient already falling is not dropped twice', async ({ page }) => {
            const r = await page.evaluate(() => {
                startGame(); enemies.length = 0;
                const ing = ingredients.find((i) => i.stack === 0 && i.floor === 0);
                const first = dropIngredient(ing);
                const before = score;
                const second = dropIngredient(ing);
                return { first, second, before, after: score };
            });
            expect(r.first).toBe(true);
            expect(r.second).toBe(false);
            expect(r.after).toBe(r.before);
        });

        test('tiles reset once an ingredient lands', async ({ page }) => {
            const clean = await page.evaluate(() => {
                startGame(); enemies.length = 0;
                const ing = ingredients.find((i) => i.stack === 3 && i.floor === 0);
                ing.tiles = [true, true, true, true];
                dropIngredient(ing);
                for (let i = 0; i < 300 && ing.falling; i++) step(0.016);
                return ing.tiles.every((t) => !t);
            });
            expect(clean).toBe(true);
        });

        test('an ingredient reaching the plate is counted', async ({ page }) => {
            const r = await page.evaluate(() => {
                startGame(); enemies.length = 0;
                const ing = ingredients.find((i) => i.stack === 0 && i.floor === 3);
                dropIngredient(ing);
                for (let i = 0; i < 300 && ing.falling; i++) step(0.016);
                return { count: plateCount[0], floor: ing.floor, plateFloor: PLATE_FLOOR };
            });
            expect(r.floor).toBe(r.plateFloor);
            expect(r.count).toBe(1);
        });

        test('plated ingredients stack up above the plate', async ({ page }) => {
            const r = await page.evaluate(() => {
                startGame(); enemies.length = 0;
                let guard = 0;
                while (plateCount[0] < INGREDIENTS_PER_BURGER && guard++ < 40) {
                    for (const ing of ingredients) {
                        if (ing.stack === 0) dropIngredient(ing);
                    }
                    for (let i = 0; i < 600 && ingredients.some((x) => x.falling); i++) step(0.016);
                }
                return {
                    ys: ingredients.filter((i) => i.stack === 0).map((i) => i.y).sort((a, b) => b - a),
                    base: FLOOR_Y[PLATE_FLOOR] - ITEM_H,
                    itemH: ITEM_H,
                };
            });
            expect(r.ys).toEqual([0, 1, 2, 3].map((n) => r.base - n * r.itemH));
        });

        test('a completed burger increments burgersDone', async ({ page }) => {
            const done = await page.evaluate(() => {
                startGame(); enemies.length = 0;
                let guard = 0;
                while (plateCount[1] < INGREDIENTS_PER_BURGER && guard++ < 40) {
                    for (const ing of ingredients) {
                        if (ing.stack === 1) dropIngredient(ing);
                    }
                    for (let i = 0; i < 600 && ingredients.some((x) => x.falling); i++) step(0.016);
                }
                return { burgersDone, plate: plateCount[1] };
            });
            expect(done.plate).toBe(4);
            expect(done.burgersDone).toBe(1);
        });
    });

    // -----------------------------------------------------------------------
    // Pepper
    // -----------------------------------------------------------------------
    test.describe('pepper', () => {
        test('firing pepper spends a shot', async ({ page }) => {
            const r = await page.evaluate(() => {
                startGame();
                const before = pepper;
                const fired = firePepper();
                return { before, after: pepper, fired, clouds: peppers.length };
            });
            expect(r.fired).toBe(true);
            expect(r.after).toBe(r.before - 1);
            expect(r.clouds).toBe(1);
        });

        test('firing with no pepper left fails', async ({ page }) => {
            const r = await page.evaluate(() => {
                startGame();
                pepper = 0;
                return { fired: firePepper(), clouds: peppers.length };
            });
            expect(r.fired).toBe(false);
            expect(r.clouds).toBe(0);
        });

        test('a pepper cloud stuns an enemy in front of the chef', async ({ page }) => {
            const stun = await page.evaluate(() => {
                startGame();
                const e = enemies[0];
                setChefPos(e.x - TILE, e.y);
                setChefFace(1);
                firePepper();
                step(0.016);
                return e.stun;
            });
            expect(stun).toBeGreaterThan(0);
        });

        test('a pepper cloud misses an enemy behind the chef', async ({ page }) => {
            const stun = await page.evaluate(() => {
                startGame();
                const e = enemies[0];
                setChefPos(e.x - TILE, e.y);
                setChefFace(-1);
                firePepper();
                step(0.016);
                return e.stun;
            });
            expect(stun).toBe(0);
        });

        test('a stunned enemy does not move', async ({ page }) => {
            const r = await page.evaluate(() => {
                startGame();
                const e = enemies[0];
                e.stun = 3;
                const before = { x: e.x, y: e.y };
                for (let i = 0; i < 30; i++) step(0.016);
                return { before, after: { x: e.x, y: e.y } };
            });
            expect(r.after.x).toBeCloseTo(r.before.x, 5);
            expect(r.after.y).toBeCloseTo(r.before.y, 5);
        });

        test('the stun wears off', async ({ page }) => {
            const stun = await page.evaluate(() => {
                startGame();
                const e = enemies[0];
                e.stun = 0.2;
                for (let i = 0; i < 40; i++) step(0.016);
                return e.stun;
            });
            expect(stun).toBe(0);
        });

        test('Space fires pepper while the game is running', async ({ page }) => {
            await page.evaluate(() => startGame());
            const before = await page.evaluate(() => pepper);
            await page.keyboard.press('Space');
            expect(await page.evaluate(() => pepper)).toBe(before - 1);
        });
    });

    // -----------------------------------------------------------------------
    // Enemies
    // -----------------------------------------------------------------------
    test.describe('enemies', () => {
        test('enemies move over time', async ({ page }) => {
            const moved = await page.evaluate(() => {
                startGame();
                const start = enemies.map((e) => ({ x: e.x, y: e.y }));
                for (let i = 0; i < 60; i++) step(0.016);
                return enemies.some((e, i) => Math.hypot(e.x - start[i].x, e.y - start[i].y) > 1);
            });
            expect(moved).toBe(true);
        });

        test('enemies stay inside the play field', async ({ page }) => {
            const ok = await page.evaluate(() => {
                startGame();
                for (let i = 0; i < 600; i++) {
                    step(0.016);
                    if (enemies.some((e) => e.x < 0 || e.x > CANVAS_W || e.y < 0 || e.y > CANVAS_H)) return false;
                }
                return true;
            });
            expect(ok).toBe(true);
        });

        test('enemies stay on the girders and ladders', async ({ page }) => {
            const ok = await page.evaluate(() => {
                startGame();
                for (let i = 0; i < 400; i++) {
                    step(0.016);
                    for (const e of enemies) {
                        const onFloor = FLOOR_Y.some((y) => Math.abs(e.y - y) < 0.001);
                        const onLadder = LADDER_X.some((x) => Math.abs(e.x - x) < 0.001);
                        if (!onFloor && !onLadder) return false;
                    }
                }
                return true;
            });
            expect(ok).toBe(true);
        });

        test('enemies home in on a stationary chef', async ({ page }) => {
            const r = await page.evaluate(() => {
                startGame();
                setChefPos(LADDER_X[2], FLOOR_Y[4]);
                const dist = () => Math.min(...enemies.map((e) => Math.hypot(e.x - chef.x, e.y - chef.y)));
                const before = dist();
                let closest = before;
                for (let i = 0; i < 400; i++) {
                    step(0.016);
                    if (state !== 'running') break;
                    closest = Math.min(closest, dist());
                }
                return { before, closest };
            });
            expect(r.closest).toBeLessThan(r.before);
        });

        test('touching an enemy costs a life', async ({ page }) => {
            const r = await page.evaluate(() => {
                startGame();
                const before = lives;
                const e = enemies[0];
                setChefPos(e.x, e.y);
                step(0.016);
                return { before, after: lives };
            });
            expect(r.after).toBe(r.before - 1);
        });

        test('losing a life resets the chef to the start', async ({ page }) => {
            const r = await page.evaluate(() => {
                startGame();
                const startX = chef.x, startY = chef.y;
                const e = enemies[0];
                setChefPos(e.x, e.y);
                step(0.016);
                return { x: chef.x, y: chef.y, startX, startY };
            });
            expect(r.x).toBe(r.startX);
            expect(r.y).toBe(r.startY);
        });

        test('a stunned enemy is harmless', async ({ page }) => {
            const r = await page.evaluate(() => {
                startGame();
                const e = enemies[0];
                e.stun = 5;
                setChefPos(e.x, e.y);
                const before = lives;
                step(0.016);
                return { before, after: lives };
            });
            expect(r.after).toBe(r.before);
        });

        test('a falling ingredient squashes an enemy and scores', async ({ page }) => {
            const r = await page.evaluate(() => {
                startGame();
                const ing = ingredients.find((i) => i.stack === 0 && i.floor === 0);
                const e = enemies[0];
                placeEnemy(e, ing.x + ITEM_W / 2, FLOOR_Y[1]);
                e.stun = 99;                                  // hold it still under the drop
                const before = score;
                dropIngredient(ing);
                for (let i = 0; i < 200 && !e.squashed; i++) step(0.016);
                return { before, after: score, squashed: e.squashed, points: SQUASH_SCORE };
            });
            expect(r.squashed).toBe(true);
            expect(r.points).toBeGreaterThan(0);
            expect(r.after).toBeGreaterThanOrEqual(r.before + r.points);
        });

        test('a squashed enemy respawns after a delay', async ({ page }) => {
            const r = await page.evaluate(() => {
                startGame();
                const e = enemies[0];
                squashEnemy(e);
                const wasSquashed = e.squashed;
                for (let i = 0; i < 600; i++) step(0.016);
                return { wasSquashed, squashed: e.squashed };
            });
            expect(r.wasSquashed).toBe(true);
            expect(r.squashed).toBe(false);
        });

        test('a squashed enemy is harmless while flattened', async ({ page }) => {
            const lost = await page.evaluate(() => {
                startGame();
                const e = enemies[0];
                squashEnemy(e);
                const before = lives;
                setChefPos(e.x, e.y);
                step(0.016);
                return before - lives;
            });
            expect(lost).toBe(0);
        });
    });

    // -----------------------------------------------------------------------
    // Game over
    // -----------------------------------------------------------------------
    test.describe('game over', () => {
        test('running out of lives ends the game', async ({ page }) => {
            const s = await page.evaluate(() => {
                startGame();
                lives = 1;
                setChefPos(enemies[0].x, enemies[0].y);
                step(0.016);
                return state;
            });
            expect(s).toBe('over');
            await expect(page.locator('#overlay')).toHaveClass(/visible/);
            await expect(page.locator('#overlay-title')).toContainText(/over/i);
        });

        test('the best score is saved to localStorage', async ({ page }) => {
            const saved = await page.evaluate(() => {
                startGame();
                score = 777;
                lives = 1;
                setChefPos(enemies[0].x, enemies[0].y);
                step(0.016);
                return window.localStorage.getItem('burgertime-best');
            });
            expect(saved).toBe('777');
        });

        test('stepping after game over changes nothing', async ({ page }) => {
            const r = await page.evaluate(() => {
                startGame();
                lives = 1;
                setChefPos(enemies[0].x, enemies[0].y);
                step(0.016);
                const snapshot = JSON.stringify(enemies.map((e) => [e.x, e.y]));
                for (let i = 0; i < 30; i++) step(0.016);
                return { state, same: snapshot === JSON.stringify(enemies.map((e) => [e.x, e.y])) };
            });
            expect(r.state).toBe('over');
            expect(r.same).toBe(true);
        });

        test('Space restarts after game over', async ({ page }) => {
            await page.evaluate(() => {
                startGame();
                lives = 1;
                setChefPos(enemies[0].x, enemies[0].y);
                step(0.016);
            });
            await page.keyboard.press('Space');
            const r = await page.evaluate(() => ({ state, lives, score }));
            expect(r.state).toBe('running');
            expect(r.lives).toBe(3);
            expect(r.score).toBe(0);
        });
    });

    // -----------------------------------------------------------------------
    // Level progression
    // -----------------------------------------------------------------------
    test.describe('levels', () => {
        test('plating every burger advances to the next level', async ({ page }) => {
            const r = await page.evaluate(() => {
                startGame(); enemies.length = 0;
                let guard = 0;
                while (level === 1 && guard++ < 40) {
                    for (const ing of ingredients) dropIngredient(ing);
                    for (let i = 0; i < 600 && ingredients.some((x) => x.falling); i++) step(0.016);
                }
                return { level, plates: plateCount.slice(), total: ingredients.length, burgersDone };
            });
            expect(r.level).toBe(2);
            expect(r.plates).toEqual([0, 0, 0, 0]);
            expect(r.total).toBe(16);
            expect(r.burgersDone).toBe(0);
        });

        test('a new level rebuilds the burgers and adds an enemy', async ({ page }) => {
            const r = await page.evaluate(() => {
                startGame();
                const before = enemies.length;
                nextLevel();
                return {
                    before,
                    after: enemies.length,
                    level,
                    resting: ingredients.every((i) => !i.falling && i.floor < PLATE_FLOOR),
                    burgersDone,
                };
            });
            expect(r.level).toBe(2);
            expect(r.resting).toBe(true);
            expect(r.burgersDone).toBe(0);
            expect(r.after).toBe(r.before + 1);
        });

        test('enemies get faster each level', async ({ page }) => {
            const r = await page.evaluate(() => {
                startGame();
                const first = enemySpeed();
                nextLevel();
                return { first, second: enemySpeed() };
            });
            expect(r.second).toBeGreaterThan(r.first);
        });
    });

    // -----------------------------------------------------------------------
    // Pause & HUD
    // -----------------------------------------------------------------------
    test.describe('pause and HUD', () => {
        test('P pauses and resumes the game', async ({ page }) => {
            await page.evaluate(() => startGame());
            await page.keyboard.press('p');
            expect(await page.evaluate(() => state)).toBe('paused');
            await page.keyboard.press('p');
            expect(await page.evaluate(() => state)).toBe('running');
        });

        test('nothing moves while paused', async ({ page }) => {
            const r = await page.evaluate(() => {
                startGame();
                setChefDir(1, 0);
                togglePause();
                const before = chef.x;
                for (let i = 0; i < 30; i++) step(0.016);
                return { before, after: chef.x };
            });
            expect(r.after).toBe(r.before);
        });

        test('the HUD reflects score, lives and pepper', async ({ page }) => {
            await page.evaluate(() => {
                startGame();
                score = 1250;
                lives = 2;
                pepper = 3;
                updateHud();
            });
            await expect(page.locator('#score')).toHaveText('1250');
            await expect(page.locator('#lives')).toHaveText('2');
            await expect(page.locator('#pepper')).toHaveText('3');
        });

        test('the animation loop advances the game on its own', async ({ page }) => {
            const r = await page.evaluate(async () => {
                setAutoRun(true);
                startGame();
                enemies.length = 0;
                setChefDir(1, 0);
                const before = chef.x;
                await new Promise((resolve) => setTimeout(resolve, 300));
                return { before, after: chef.x };
            });
            expect(r.after).toBeGreaterThan(r.before);
        });
    });
});
