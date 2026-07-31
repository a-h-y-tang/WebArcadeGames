const { test, expect } = require('@playwright/test');
const path = require('path');
const { pathToFileURL } = require('url');

const GAME_URL = pathToFileURL(path.resolve(__dirname, '../index.html')).href;

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

        test('score, level, lives and pepper start at their defaults', async ({ page }) => {
            await expect(page.locator('#score')).toHaveText('0');
            await expect(page.locator('#level')).toHaveText('1');
            await expect(page.locator('#lives')).toHaveText('3');
            await expect(page.locator('#pepper')).toHaveText('5');
            await expect(page.locator('#best')).toHaveText('0');
        });

        test('canvas matches the world size', async ({ page }) => {
            const size = await page.evaluate(() => ({ w: CANVAS_W, h: CANVAS_H }));
            const canvas = page.locator('#canvas');
            await expect(canvas).toHaveAttribute('width', String(size.w));
            await expect(canvas).toHaveAttribute('height', String(size.h));
        });

        test('state is idle before starting', async ({ page }) => {
            expect(await page.evaluate(() => state)).toBe('idle');
        });

        test('no enemies before starting', async ({ page }) => {
            expect(await page.evaluate(() => enemies.length)).toBe(0);
        });

        test('the burger layout is built so the board is visible while idle', async ({ page }) => {
            expect(await page.evaluate(() => ingredients.length)).toBe(12);
        });

        test('best score loads from localStorage', async ({ page }) => {
            await page.evaluate(() => window.localStorage.setItem('burgertime-best', '4200'));
            await page.reload();
            await expect(page.locator('#best')).toHaveText('4200');
        });

        test('step does nothing while idle', async ({ page }) => {
            const same = await page.evaluate(() => {
                const before = chef.x;
                setChefDir(1, 0);
                for (let i = 0; i < 20; i++) step(0.016);
                return chef.x === before;
            });
            expect(same).toBe(true);
        });
    });

    // -----------------------------------------------------------------------
    // Starting the game
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

        test('a new game resets score, level, lives and pepper', async ({ page }) => {
            const s = await page.evaluate(() => {
                score = 999; level = 4; lives = 1; pepper = 0;
                startGame();
                return { score, level, lives, pepper };
            });
            expect(s).toEqual({ score: 0, level: 1, lives: 3, pepper: 5 });
        });

        test('the chef starts on the bottom floor', async ({ page }) => {
            const ok = await page.evaluate(() => {
                startGame();
                return chef.y === floorY(FLOOR_ROWS.length - 1);
            });
            expect(ok).toBe(true);
        });
    });

    // -----------------------------------------------------------------------
    // Board layout
    // -----------------------------------------------------------------------
    test.describe('layout', () => {
        test('there are three burger columns of four ingredients', async ({ page }) => {
            const counts = await page.evaluate(() => {
                startGame();
                return BURGER_COLS.map((c) => ingredients.filter((i) => i.col === c).length);
            });
            expect(counts).toEqual([4, 4, 4]);
        });

        test('every column holds one of each ingredient type', async ({ page }) => {
            const types = await page.evaluate(() => {
                startGame();
                return BURGER_COLS.map((c) =>
                    ingredients.filter((i) => i.col === c).map((i) => i.type).sort()
                );
            });
            for (const col of types) {
                expect(col).toEqual(['bun-bottom', 'bun-top', 'lettuce', 'patty']);
            }
        });

        test('ingredients start on the top four floors, resting on the beams', async ({ page }) => {
            const ok = await page.evaluate(() => {
                startGame();
                return ingredients.every(
                    (i) => i.floor >= 0 && i.floor <= 3 && i.y === restY(i.floor) && !i.falling && !i.plated
                );
            });
            expect(ok).toBe(true);
        });

        test('ingredients start with four un-stepped segments', async ({ page }) => {
            const ok = await page.evaluate(() => {
                startGame();
                return ingredients.every((i) => i.segs.length === 4 && i.segs.every((s) => s === false));
            });
            expect(ok).toBe(true);
        });

        test('there is one empty plate per burger column', async ({ page }) => {
            const plateState = await page.evaluate(() => {
                startGame();
                return { count: plates.length, stacks: plates.map((p) => p.count) };
            });
            expect(plateState.count).toBe(3);
            expect(plateState.stacks).toEqual([0, 0, 0]);
        });
    });

    // -----------------------------------------------------------------------
    // Chef movement
    // -----------------------------------------------------------------------
    test.describe('chef movement', () => {
        test('walking right increases x', async ({ page }) => {
            const moved = await page.evaluate(() => {
                startGame();
                enemySpawnTimer = 999;
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
                enemySpawnTimer = 999;
                const before = chef.x;
                setChefDir(-1, 0);
                for (let i = 0; i < 10; i++) step(0.016);
                return chef.x < before;
            });
            expect(moved).toBe(true);
        });

        test('the chef cannot walk off the left edge', async ({ page }) => {
            const x = await page.evaluate(() => {
                startGame();
                enemySpawnTimer = 999;
                setChefDir(-1, 0);
                for (let i = 0; i < 600; i++) step(0.016);
                return chef.x;
            });
            expect(x).toBeGreaterThanOrEqual(0);
        });

        test('the chef cannot walk off the right edge', async ({ page }) => {
            const { x, w } = await page.evaluate(() => {
                startGame();
                enemySpawnTimer = 999;
                setChefDir(1, 0);
                for (let i = 0; i < 600; i++) step(0.016);
                return { x: chef.x, w: CANVAS_W };
            });
            expect(x).toBeLessThanOrEqual(w);
        });

        test('the chef cannot climb where there is no ladder', async ({ page }) => {
            const same = await page.evaluate(() => {
                startGame();
                enemySpawnTimer = 999;
                placeChef(CANVAS_W / 2, floorY(FLOOR_ROWS.length - 1));
                const before = chef.y;
                setChefDir(0, -1);
                for (let i = 0; i < 30; i++) step(0.016);
                return chef.y === before;
            });
            expect(same).toBe(true);
        });

        test('climbing a ladder moves the chef up', async ({ page }) => {
            const climbed = await page.evaluate(() => {
                startGame();
                enemySpawnTimer = 999;
                placeChef(ladderX(LADDER_COLS[1]), floorY(FLOOR_ROWS.length - 1));
                const before = chef.y;
                setChefDir(0, -1);
                for (let i = 0; i < 20; i++) step(0.016);
                return chef.y < before;
            });
            expect(climbed).toBe(true);
        });

        test('climbing snaps the chef to the ladder centre', async ({ page }) => {
            const x = await page.evaluate(() => {
                startGame();
                enemySpawnTimer = 999;
                placeChef(ladderX(LADDER_COLS[1]) + 5, floorY(FLOOR_ROWS.length - 1));
                setChefDir(0, -1);
                step(0.016);
                return { chefX: chef.x, ladder: ladderX(LADDER_COLS[1]) };
            });
            expect(x.chefX).toBe(x.ladder);
        });

        test('climbing down from an upper floor increases y', async ({ page }) => {
            const ok = await page.evaluate(() => {
                startGame();
                enemySpawnTimer = 999;
                placeChef(ladderX(LADDER_COLS[0]), floorY(0));
                const before = chef.y;
                setChefDir(0, 1);
                for (let i = 0; i < 20; i++) step(0.016);
                return chef.y > before;
            });
            expect(ok).toBe(true);
        });

        test('the chef cannot climb above the top floor', async ({ page }) => {
            const y = await page.evaluate(() => {
                startGame();
                enemySpawnTimer = 999;
                placeChef(ladderX(LADDER_COLS[0]), floorY(0));
                setChefDir(0, -1);
                for (let i = 0; i < 200; i++) step(0.016);
                return { chefY: chef.y, top: floorY(0) };
            });
            expect(y.chefY).toBe(y.top);
        });

        test('the chef cannot climb below the bottom floor', async ({ page }) => {
            const y = await page.evaluate(() => {
                startGame();
                enemySpawnTimer = 999;
                placeChef(ladderX(LADDER_COLS[0]), floorY(FLOOR_ROWS.length - 1));
                setChefDir(0, 1);
                for (let i = 0; i < 200; i++) step(0.016);
                return { chefY: chef.y, bottom: floorY(FLOOR_ROWS.length - 1) };
            });
            expect(y.chefY).toBe(y.bottom);
        });

        test('ArrowRight moves the chef right', async ({ page }) => {
            await page.evaluate(() => { startGame(); enemySpawnTimer = 999; });
            const before = await page.evaluate(() => chef.x);
            await page.keyboard.down('ArrowRight');
            await page.evaluate(() => { for (let i = 0; i < 10; i++) step(0.016); });
            await page.keyboard.up('ArrowRight');
            expect(await page.evaluate(() => chef.x)).toBeGreaterThan(before);
        });

        test('ArrowUp climbs a ladder', async ({ page }) => {
            await page.evaluate(() => {
                startGame();
                enemySpawnTimer = 999;
                placeChef(ladderX(LADDER_COLS[1]), floorY(FLOOR_ROWS.length - 1));
            });
            const before = await page.evaluate(() => chef.y);
            await page.keyboard.down('ArrowUp');
            await page.evaluate(() => { for (let i = 0; i < 20; i++) step(0.016); });
            await page.keyboard.up('ArrowUp');
            expect(await page.evaluate(() => chef.y)).toBeLessThan(before);
        });
    });

    // -----------------------------------------------------------------------
    // Walking on ingredients
    // -----------------------------------------------------------------------
    test.describe('stepping ingredients', () => {
        test('standing on a segment marks it as stepped', async ({ page }) => {
            const segs = await page.evaluate(() => {
                startGame();
                enemySpawnTimer = 999;
                const ing = ingredients.find((i) => i.col === BURGER_COLS[0] && i.floor === 0);
                placeChef(ing.x + TILE * 0.5, floorY(0));
                step(0.016);
                return ing.segs.slice();
            });
            expect(segs).toEqual([true, false, false, false]);
        });

        test('an ingredient does not fall until every segment is stepped', async ({ page }) => {
            const falling = await page.evaluate(() => {
                startGame();
                enemySpawnTimer = 999;
                const ing = ingredients.find((i) => i.col === BURGER_COLS[0] && i.floor === 0);
                for (const seg of [0, 1, 2]) {
                    placeChef(ing.x + TILE * (seg + 0.5), floorY(0));
                    step(0.016);
                }
                return ing.falling;
            });
            expect(falling).toBe(false);
        });

        test('stepping every segment drops the ingredient', async ({ page }) => {
            const res = await page.evaluate(() => {
                startGame();
                enemySpawnTimer = 999;
                const ing = ingredients.find((i) => i.col === BURGER_COLS[0] && i.floor === 0);
                for (const seg of [0, 1, 2, 3]) {
                    placeChef(ing.x + TILE * (seg + 0.5), floorY(0));
                    step(0.016);
                }
                return { falling: ing.falling, score };
            });
            expect(res.falling).toBe(true);
            expect(res.score).toBeGreaterThanOrEqual(50);
        });

        test('the chef cannot step an ingredient from a different floor', async ({ page }) => {
            const segs = await page.evaluate(() => {
                startGame();
                enemySpawnTimer = 999;
                const ing = ingredients.find((i) => i.col === BURGER_COLS[0] && i.floor === 0);
                placeChef(ing.x + TILE * 0.5, floorY(2));
                step(0.016);
                return ing.segs.slice();
            });
            expect(segs).toEqual([false, false, false, false]);
        });

        test('a falling ingredient moves downward', async ({ page }) => {
            const moved = await page.evaluate(() => {
                startGame();
                enemySpawnTimer = 999;
                const ing = ingredients.find((i) => i.col === BURGER_COLS[0] && i.floor === 0);
                ing.segs.fill(true);
                step(0.016);
                const before = ing.y;
                for (let i = 0; i < 5; i++) step(0.016);
                return ing.y > before;
            });
            expect(moved).toBe(true);
        });

        test('a dropped ingredient lands on the next floor with fresh segments', async ({ page }) => {
            const res = await page.evaluate(() => {
                startGame();
                enemySpawnTimer = 999;
                // Clear the column below so nothing cascades.
                const ing = ingredients.find((i) => i.col === BURGER_COLS[0] && i.floor === 0);
                for (const other of ingredients.filter((i) => i.col === BURGER_COLS[0] && i !== ing)) {
                    other.floor = 3;
                    other.y = restY(3);
                }
                ing.segs.fill(true);
                for (let i = 0; i < 80; i++) step(0.016);
                return { floor: ing.floor, falling: ing.falling, y: ing.y, rest: restY(1), segs: ing.segs.slice() };
            });
            expect(res.falling).toBe(false);
            expect(res.floor).toBe(1);
            expect(res.y).toBe(res.rest);
            expect(res.segs).toEqual([false, false, false, false]);
        });

        test('an ingredient dropped from the bottom floor lands on the plate', async ({ page }) => {
            const res = await page.evaluate(() => {
                startGame();
                enemySpawnTimer = 999;
                const ing = ingredients.find((i) => i.col === BURGER_COLS[0] && i.type === 'bun-bottom');
                ing.floor = FLOOR_ROWS.length - 1;
                ing.y = restY(ing.floor);
                ing.segs.fill(true);
                for (let i = 0; i < 120; i++) step(0.016);
                return { plated: ing.plated, falling: ing.falling, stack: plates[0].count };
            });
            expect(res.falling).toBe(false);
            expect(res.plated).toBe(true);
            expect(res.stack).toBe(1);
        });

        test('plated ingredients stack on top of each other', async ({ page }) => {
            const res = await page.evaluate(() => {
                startGame();
                enemySpawnTimer = 999;
                const col = ingredients.filter((i) => i.col === BURGER_COLS[0]);
                const [first, second] = col;
                for (const ing of [first, second]) {
                    ing.floor = FLOOR_ROWS.length - 1;
                    ing.y = restY(ing.floor);
                    ing.segs.fill(true);
                    for (let i = 0; i < 120; i++) step(0.016);
                }
                return { firstY: first.y, secondY: second.y, stack: plates[0].count };
            });
            expect(res.stack).toBe(2);
            expect(res.secondY).toBeLessThan(res.firstY);
        });

        test('a falling ingredient pushes the ingredients below it down a level', async ({ page }) => {
            const floors = await page.evaluate(() => {
                startGame();
                enemySpawnTimer = 999;
                const top = ingredients.find((i) => i.col === BURGER_COLS[0] && i.floor === 0);
                top.segs.fill(true);
                for (let i = 0; i < 400; i++) step(0.016);
                return ingredients
                    .filter((i) => i.col === BURGER_COLS[0])
                    .map((i) => i.floor)
                    .sort((a, b) => a - b);
            });
            expect(floors).toEqual([1, 2, 3, 4]);
        });
    });

    // -----------------------------------------------------------------------
    // Playing for real
    // -----------------------------------------------------------------------
    test.describe('gameplay', () => {
        test('walking the whole width of an ingredient knocks it down', async ({ page }) => {
            const res = await page.evaluate(() => {
                startGame();
                enemySpawnTimer = 999;
                const ing = ingredients.find((i) => i.col === BURGER_COLS[1] && i.floor === 3);
                placeChef(ing.x - 4, floorY(3));
                setChefDir(1, 0);
                for (let i = 0; i < 200; i++) step(0.016);
                return { floor: ing.floor, falling: ing.falling };
            });
            expect(res.falling).toBe(false);
            expect(res.floor).toBe(4);
        });

        test('a long unattended run keeps the world consistent', async ({ page }) => {
            const res = await page.evaluate(() => {
                startGame();
                for (let i = 0; i < 1200; i++) step(0.016);
                return {
                    state,
                    lives,
                    enemies: enemies.length,
                    inBounds: ingredients.every((i) => i.y >= 0 && i.y <= CANVAS_H),
                    plated: plates.reduce((n, p) => n + p.count, 0),
                };
            });
            expect(['running', 'over']).toContain(res.state);
            expect(res.lives).toBeGreaterThanOrEqual(0);
            expect(res.enemies).toBeLessThanOrEqual(5);
            expect(res.inBounds).toBe(true);
            expect(res.plated).toBeGreaterThanOrEqual(0);
        });
    });

    // -----------------------------------------------------------------------
    // Level completion
    // -----------------------------------------------------------------------
    test.describe('level completion', () => {
        test('plating every ingredient advances to the next level', async ({ page }) => {
            const res = await page.evaluate(() => {
                startGame();
                enemySpawnTimer = 999;
                for (const ing of ingredients) plateIngredient(ing);
                step(0.016);
                return { level, plated: ingredients.filter((i) => i.plated).length, score };
            });
            expect(res.level).toBe(2);
            expect(res.plated).toBe(0);
            expect(res.score).toBeGreaterThan(0);
        });

        test('the next level rebuilds a full board', async ({ page }) => {
            const res = await page.evaluate(() => {
                startGame();
                enemySpawnTimer = 999;
                for (const ing of ingredients) plateIngredient(ing);
                step(0.016);
                return {
                    ingredients: ingredients.length,
                    stacks: plates.map((p) => p.count),
                    state,
                };
            });
            expect(res.ingredients).toBe(12);
            expect(res.stacks).toEqual([0, 0, 0]);
            expect(res.state).toBe('running');
        });

        test('enemies get faster on later levels', async ({ page }) => {
            const res = await page.evaluate(() => {
                startGame();
                const first = enemySpeed();
                level = 4;
                return { first, later: enemySpeed() };
            });
            expect(res.later).toBeGreaterThan(res.first);
        });
    });

    // -----------------------------------------------------------------------
    // Enemies
    // -----------------------------------------------------------------------
    test.describe('enemies', () => {
        test('spawnEnemy adds an enemy at the requested spot', async ({ page }) => {
            const res = await page.evaluate(() => {
                startGame();
                enemies.length = 0;
                spawnEnemy(200, floorY(0), 'egg');
                return { count: enemies.length, x: enemies[0].x, y: enemies[0].y, type: enemies[0].type };
            });
            expect(res.count).toBe(1);
            expect(res.x).toBe(200);
            expect(res.type).toBe('egg');
        });

        test('an enemy on the chef\'s floor walks toward the chef', async ({ page }) => {
            const closer = await page.evaluate(() => {
                startGame();
                enemySpawnTimer = 999;
                enemies.length = 0;
                placeChef(120, floorY(FLOOR_ROWS.length - 1));
                const e = spawnEnemy(400, floorY(FLOOR_ROWS.length - 1), 'dog');
                const before = e.x;
                for (let i = 0; i < 20; i++) step(0.016);
                return e.x < before;
            });
            expect(closer).toBe(true);
        });

        test('an enemy on another floor heads for a ladder', async ({ page }) => {
            const climbed = await page.evaluate(() => {
                startGame();
                enemySpawnTimer = 999;
                enemies.length = 0;
                placeChef(ladderX(LADDER_COLS[0]), floorY(0));
                const e = spawnEnemy(ladderX(LADDER_COLS[0]), floorY(FLOOR_ROWS.length - 1), 'dog');
                const before = e.y;
                for (let i = 0; i < 60; i++) step(0.016);
                return e.y < before;
            });
            expect(climbed).toBe(true);
        });

        test('touching an enemy costs a life and clears the board of enemies', async ({ page }) => {
            const res = await page.evaluate(() => {
                startGame();
                enemySpawnTimer = 999;
                enemies.length = 0;
                spawnEnemy(chef.x, chef.y, 'dog');
                step(0.016);
                return { lives, enemies: enemies.length, state };
            });
            expect(res.lives).toBe(2);
            expect(res.enemies).toBe(0);
            expect(res.state).toBe('running');
        });

        test('losing the last life ends the game', async ({ page }) => {
            const res = await page.evaluate(() => {
                startGame();
                enemySpawnTimer = 999;
                lives = 1;
                enemies.length = 0;
                spawnEnemy(chef.x, chef.y, 'dog');
                step(0.016);
                return { lives, state };
            });
            expect(res.lives).toBe(0);
            expect(res.state).toBe('over');
            await expect(page.locator('#overlay')).toHaveClass(/visible/);
        });

        test('a falling ingredient squashes an enemy for bonus points', async ({ page }) => {
            const res = await page.evaluate(() => {
                startGame();
                enemySpawnTimer = 999;
                enemies.length = 0;
                placeChef(20, floorY(FLOOR_ROWS.length - 1));
                const ing = ingredients.find((i) => i.col === BURGER_COLS[0] && i.floor === 0);
                spawnEnemy(ing.x + TILE * 2, floorY(1), 'pickle');
                const before = score;
                ing.segs.fill(true);
                for (let i = 0; i < 80; i++) step(0.016);
                return { enemies: enemies.length, gained: score - before, lives };
            });
            expect(res.enemies).toBe(0);
            expect(res.gained).toBeGreaterThanOrEqual(500);
            expect(res.lives).toBe(3);
        });

        test('enemies spawn over time while the game runs', async ({ page }) => {
            const count = await page.evaluate(() => {
                startGame();
                enemies.length = 0;
                enemySpawnTimer = 0.02;
                for (let i = 0; i < 10; i++) step(0.016);
                return enemies.length;
            });
            expect(count).toBeGreaterThan(0);
        });
    });

    // -----------------------------------------------------------------------
    // Pepper
    // -----------------------------------------------------------------------
    test.describe('pepper', () => {
        test('throwing pepper uses a shaker', async ({ page }) => {
            const res = await page.evaluate(() => {
                startGame();
                enemySpawnTimer = 999;
                firePepper();
                return pepper;
            });
            expect(res).toBe(4);
        });

        test('pepper stuns an enemy in front of the chef', async ({ page }) => {
            const stun = await page.evaluate(() => {
                startGame();
                enemySpawnTimer = 999;
                enemies.length = 0;
                placeChef(200, floorY(FLOOR_ROWS.length - 1));
                setChefDir(1, 0);
                step(0.016);
                const e = spawnEnemy(chef.x + 26, chef.y, 'dog');
                firePepper();
                return e.stun;
            });
            expect(stun).toBeGreaterThan(0);
        });

        test('pepper does not reach enemies behind the chef', async ({ page }) => {
            const stun = await page.evaluate(() => {
                startGame();
                enemySpawnTimer = 999;
                enemies.length = 0;
                placeChef(200, floorY(FLOOR_ROWS.length - 1));
                setChefDir(1, 0);
                step(0.016);
                const e = spawnEnemy(chef.x - 60, chef.y, 'dog');
                firePepper();
                return e.stun;
            });
            expect(stun).toBe(0);
        });

        test('a stunned enemy does not move', async ({ page }) => {
            const same = await page.evaluate(() => {
                startGame();
                enemySpawnTimer = 999;
                enemies.length = 0;
                placeChef(120, floorY(FLOOR_ROWS.length - 1));
                const e = spawnEnemy(400, floorY(FLOOR_ROWS.length - 1), 'dog');
                e.stun = 5;
                const before = e.x;
                for (let i = 0; i < 20; i++) step(0.016);
                return e.x === before;
            });
            expect(same).toBe(true);
        });

        test('a stunned enemy cannot hurt the chef', async ({ page }) => {
            const res = await page.evaluate(() => {
                startGame();
                enemySpawnTimer = 999;
                enemies.length = 0;
                const e = spawnEnemy(chef.x, chef.y, 'dog');
                e.stun = 5;
                step(0.016);
                return { lives, enemies: enemies.length };
            });
            expect(res.lives).toBe(3);
            expect(res.enemies).toBe(1);
        });

        test('the stun wears off', async ({ page }) => {
            const stun = await page.evaluate(() => {
                startGame();
                enemySpawnTimer = 999;
                enemies.length = 0;
                placeChef(120, floorY(FLOOR_ROWS.length - 1));
                const e = spawnEnemy(400, floorY(FLOOR_ROWS.length - 1), 'dog');
                e.stun = 0.1;
                for (let i = 0; i < 20; i++) step(0.016);
                return e.stun;
            });
            expect(stun).toBeLessThanOrEqual(0);
        });

        test('an empty shaker cannot stun anything', async ({ page }) => {
            const res = await page.evaluate(() => {
                startGame();
                enemySpawnTimer = 999;
                enemies.length = 0;
                pepper = 0;
                placeChef(200, floorY(FLOOR_ROWS.length - 1));
                setChefDir(1, 0);
                step(0.016);
                const e = spawnEnemy(chef.x + 26, chef.y, 'dog');
                firePepper();
                return { pepper, stun: e.stun };
            });
            expect(res).toEqual({ pepper: 0, stun: 0 });
        });

        test('Space throws pepper while the game is running', async ({ page }) => {
            await page.evaluate(() => { startGame(); enemySpawnTimer = 999; });
            await page.keyboard.press('Space');
            expect(await page.evaluate(() => pepper)).toBe(4);
            expect(await page.evaluate(() => state)).toBe('running');
        });
    });

    // -----------------------------------------------------------------------
    // Pause / game over / HUD
    // -----------------------------------------------------------------------
    test.describe('pause', () => {
        test('P pauses and shows the overlay', async ({ page }) => {
            await page.evaluate(() => startGame());
            await page.keyboard.press('p');
            expect(await page.evaluate(() => state)).toBe('paused');
            await expect(page.locator('#overlay')).toHaveClass(/visible/);
        });

        test('P resumes a paused game', async ({ page }) => {
            await page.evaluate(() => startGame());
            await page.keyboard.press('p');
            await page.keyboard.press('p');
            expect(await page.evaluate(() => state)).toBe('running');
        });

        test('nothing moves while paused', async ({ page }) => {
            const same = await page.evaluate(() => {
                startGame();
                enemySpawnTimer = 999;
                setChefDir(1, 0);
                togglePause();
                const before = chef.x;
                for (let i = 0; i < 20; i++) step(0.016);
                return chef.x === before;
            });
            expect(same).toBe(true);
        });
    });

    test.describe('game over', () => {
        test('the best score is stored in localStorage', async ({ page }) => {
            const best = await page.evaluate(() => {
                startGame();
                enemySpawnTimer = 999;
                score = 3300;
                lives = 1;
                enemies.length = 0;
                spawnEnemy(chef.x, chef.y, 'dog');
                step(0.016);
                return window.localStorage.getItem('burgertime-best');
            });
            expect(best).toBe('3300');
        });

        test('a lower score does not overwrite the best', async ({ page }) => {
            const best = await page.evaluate(() => {
                window.localStorage.setItem('burgertime-best', '9000');
                loadBest();
                startGame();
                enemySpawnTimer = 999;
                score = 10;
                lives = 1;
                enemies.length = 0;
                spawnEnemy(chef.x, chef.y, 'dog');
                step(0.016);
                return window.localStorage.getItem('burgertime-best');
            });
            expect(best).toBe('9000');
        });

        test('Space restarts after a game over', async ({ page }) => {
            await page.evaluate(() => {
                startGame();
                lives = 1;
                enemies.length = 0;
                spawnEnemy(chef.x, chef.y, 'dog');
                step(0.016);
            });
            expect(await page.evaluate(() => state)).toBe('over');
            await page.keyboard.press('Space');
            expect(await page.evaluate(() => state)).toBe('running');
            expect(await page.evaluate(() => lives)).toBe(3);
        });
    });

    test.describe('hud', () => {
        test('the HUD follows the game state', async ({ page }) => {
            await page.evaluate(() => {
                startGame();
                enemySpawnTimer = 999;
                score = 1234;
                lives = 2;
                level = 3;
                pepper = 1;
                step(0.016);
            });
            await expect(page.locator('#score')).toHaveText('1234');
            await expect(page.locator('#lives')).toHaveText('2');
            await expect(page.locator('#level')).toHaveText('3');
            await expect(page.locator('#pepper')).toHaveText('1');
        });

        test('the canvas renders something once the game starts', async ({ page }) => {
            const painted = await page.evaluate(() => {
                startGame();
                step(0.016);
                draw();
                const ctx2 = document.getElementById('canvas').getContext('2d');
                const data = ctx2.getImageData(0, 0, CANVAS_W, CANVAS_H).data;
                for (let i = 0; i < data.length; i += 4) {
                    if (data[i] !== 0 || data[i + 1] !== 0 || data[i + 2] !== 0) return true;
                }
                return false;
            });
            expect(painted).toBe(true);
        });
    });
});
