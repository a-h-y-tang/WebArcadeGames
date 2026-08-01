const { test, expect } = require('@playwright/test');
const path = require('path');
const { pathToFileURL } = require('url');

const GAME_URL = pathToFileURL(path.resolve(__dirname, '../index.html')).href;

test.describe('BurgerTime', () => {
    test.beforeEach(async ({ page }) => {
        await page.goto(GAME_URL);
    });

    // -----------------------------------------------------------------------
    // Initial / idle state
    // -----------------------------------------------------------------------
    test.describe('initial state', () => {
        test('page title is BurgerTime', async ({ page }) => {
            await expect(page).toHaveTitle('BurgerTime');
        });

        test('start overlay is visible', async ({ page }) => {
            await expect(page.locator('#overlay')).toHaveClass(/visible/);
        });

        test('overlay prompts the player to start', async ({ page }) => {
            await expect(page.locator('#overlay-sub')).toContainText(/space|start/i);
        });

        test('score and best start at 0', async ({ page }) => {
            await expect(page.locator('#score')).toHaveText('0');
            await expect(page.locator('#best')).toHaveText('0');
        });

        test('canvas is 640x480', async ({ page }) => {
            const canvas = page.locator('#canvas');
            await expect(canvas).toHaveAttribute('width', '640');
            await expect(canvas).toHaveAttribute('height', '480');
        });

        test('state is idle before starting', async ({ page }) => {
            expect(await page.evaluate(() => state)).toBe('idle');
        });

        test('the board holds one ingredient per burger layer', async ({ page }) => {
            const counts = await page.evaluate(() => ({
                total: ingredients.length,
                burgers: BURGER_XS.length,
                layers: INGREDIENT_KINDS.length,
            }));
            expect(counts.total).toBe(counts.burgers * counts.layers);
        });

        test('no enemies before starting', async ({ page }) => {
            expect(await page.evaluate(() => enemies.length)).toBe(0);
        });

        test('best score loads from localStorage', async ({ page }) => {
            await page.evaluate(() => window.localStorage.setItem('burgertime-best', '4200'));
            await page.reload();
            await expect(page.locator('#best')).toHaveText('4200');
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

        test('game starts on level 1 with full lives and peppers', async ({ page }) => {
            const s = await page.evaluate(() => {
                startGame();
                return {
                    level, lives, peppers, score,
                    startLives: START_LIVES, startPeppers: START_PEPPERS,
                };
            });
            expect(s.level).toBe(1);
            expect(s.lives).toBe(s.startLives);
            expect(s.peppers).toBe(s.startPeppers);
            expect(s.score).toBe(0);
        });

        test('the chef starts on the bottom floor', async ({ page }) => {
            const p = await page.evaluate(() => {
                startGame();
                return {
                    floor: player.floor, y: player.y,
                    plate: PLATE_FLOOR, floorY: FLOOR_YS[PLATE_FLOOR],
                };
            });
            expect(p.floor).toBe(p.plate);
            expect(p.y).toBe(p.floorY);
        });

        test('every ingredient starts unlanded above the plate', async ({ page }) => {
            const ok = await page.evaluate(() => {
                startGame();
                return ingredients.every((i) => !i.landed && !i.falling && i.floor < PLATE_FLOOR);
            });
            expect(ok).toBe(true);
        });
    });

    // -----------------------------------------------------------------------
    // Board geometry helpers
    // -----------------------------------------------------------------------
    test.describe('geometry', () => {
        test('floorAtY snaps to a girder', async ({ page }) => {
            expect(await page.evaluate(() => floorAtY(FLOOR_YS[2]))).toBe(2);
        });

        test('floorAtY is null between girders', async ({ page }) => {
            const f = await page.evaluate(() => floorAtY((FLOOR_YS[2] + FLOOR_YS[3]) / 2));
            expect(f).toBe(null);
        });

        test('ladderFrom finds an aligned ladder going up', async ({ page }) => {
            const i = await page.evaluate(() => ladderFrom(LADDER_XS[2], PLATE_FLOOR, -1));
            expect(i).toBe(2);
        });

        test('ladderFrom refuses to climb above the top floor', async ({ page }) => {
            const i = await page.evaluate(() => ladderFrom(LADDER_XS[2], 0, -1));
            expect(i).toBe(null);
        });

        test('ladderFrom refuses a ladder that is out of reach', async ({ page }) => {
            const i = await page.evaluate(() => ladderFrom(LADDER_XS[2] + 40, PLATE_FLOOR, -1));
            expect(i).toBe(null);
        });
    });

    // -----------------------------------------------------------------------
    // Chef movement
    // -----------------------------------------------------------------------
    test.describe('movement', () => {
        test('moving right increases x', async ({ page }) => {
            const { before, after } = await page.evaluate(() => {
                startGame();
                placeEntityOnFloor(player, PLATE_FLOOR, 300);
                const before = player.x;
                setDir(1, 0);
                for (let i = 0; i < 20; i++) step(0.016);
                return { before, after: player.x };
            });
            expect(after).toBeGreaterThan(before);
        });

        test('moving left decreases x', async ({ page }) => {
            const { before, after } = await page.evaluate(() => {
                startGame();
                placeEntityOnFloor(player, PLATE_FLOOR, 300);
                const before = player.x;
                setDir(-1, 0);
                for (let i = 0; i < 20; i++) step(0.016);
                return { before, after: player.x };
            });
            expect(after).toBeLessThan(before);
        });

        test('the chef cannot run off the left edge', async ({ page }) => {
            const { x, min } = await page.evaluate(() => {
                startGame();
                enemies.length = 0;
                spawnTimer = 999;
                placeEntityOnFloor(player, PLATE_FLOOR, 40);
                setDir(-1, 0);
                for (let i = 0; i < 400; i++) step(0.016);
                return { x: player.x, min: PLAY_LEFT };
            });
            expect(x).toBeGreaterThanOrEqual(min);
        });

        test('the chef cannot run off the right edge', async ({ page }) => {
            const { x, max } = await page.evaluate(() => {
                startGame();
                enemies.length = 0;
                spawnTimer = 999;
                placeEntityOnFloor(player, PLATE_FLOOR, 600);
                setDir(1, 0);
                for (let i = 0; i < 400; i++) step(0.016);
                return { x: player.x, max: PLAY_RIGHT };
            });
            expect(x).toBeLessThanOrEqual(max);
        });

        test('the chef cannot climb where there is no ladder', async ({ page }) => {
            const { before, after } = await page.evaluate(() => {
                startGame();
                placeEntityOnFloor(player, PLATE_FLOOR, 100);
                const before = player.y;
                setDir(0, -1);
                for (let i = 0; i < 40; i++) step(0.016);
                return { before, after: player.y };
            });
            expect(after).toBe(before);
        });

        test('mounting a ladder snaps the chef to its centre', async ({ page }) => {
            const res = await page.evaluate(() => {
                startGame();
                placeEntityOnFloor(player, PLATE_FLOOR, LADDER_XS[2] - 8);
                setDir(0, -1);
                step(0.016);
                return { x: player.x, ladderX: LADDER_XS[2] };
            });
            expect(res.x).toBe(res.ladderX);
        });

        test('climbing up reaches the floor above', async ({ page }) => {
            const res = await page.evaluate(() => {
                startGame();
                enemies.length = 0;
                spawnTimer = 999;
                placeEntityOnFloor(player, PLATE_FLOOR, LADDER_XS[2]);
                setDir(0, -1);
                for (let i = 0; i < 500; i++) {
                    step(0.004);
                    if (player.y <= FLOOR_YS[PLATE_FLOOR - 1]) break;
                }
                return { floor: player.floor, expected: PLATE_FLOOR - 1 };
            });
            expect(res.floor).toBe(res.expected);
        });

        test('climbing stops at the top of the ladder', async ({ page }) => {
            const p = await page.evaluate(() => {
                startGame();
                enemies.length = 0;
                spawnTimer = 999;
                placeEntityOnFloor(player, PLATE_FLOOR, LADDER_XS[2]);
                setDir(0, -1);
                for (let i = 0; i < 500; i++) step(0.016);
                return { floor: player.floor, y: player.y, top: FLOOR_YS[0] };
            });
            expect(p.floor).toBe(0);
            expect(p.y).toBe(p.top);
        });

        test('climbing down increases y', async ({ page }) => {
            const { before, after } = await page.evaluate(() => {
                startGame();
                placeEntityOnFloor(player, 0, LADDER_XS[1]);
                const before = player.y;
                setDir(0, 1);
                for (let i = 0; i < 20; i++) step(0.016);
                return { before, after: player.y };
            });
            expect(after).toBeGreaterThan(before);
        });

        test('ArrowRight moves the chef right', async ({ page }) => {
            await page.evaluate(() => { startGame(); placeEntityOnFloor(player, PLATE_FLOOR, 300); });
            const before = await page.evaluate(() => player.x);
            await page.keyboard.down('ArrowRight');
            await page.evaluate(() => { for (let i = 0; i < 20; i++) step(0.016); });
            await page.keyboard.up('ArrowRight');
            expect(await page.evaluate(() => player.x)).toBeGreaterThan(before);
        });
    });

    // -----------------------------------------------------------------------
    // Ingredients
    // -----------------------------------------------------------------------
    test.describe('ingredients', () => {
        test('standing on an ingredient presses the segment underfoot', async ({ page }) => {
            const segs = await page.evaluate(() => {
                startGame();
                const ing = ingredientAt(0, 1);
                placeEntityOnFloor(player, ing.floor, ing.x + SEG_W / 2);
                step(0.016);
                return ing.segs.slice();
            });
            expect(segs[0]).toBe(true);
            expect(segs[3]).toBe(false);
        });

        test('an ingredient on another floor is not pressed', async ({ page }) => {
            const segs = await page.evaluate(() => {
                startGame();
                const ing = ingredientAt(0, 1);
                placeEntityOnFloor(player, PLATE_FLOOR, ing.x + SEG_W / 2);
                step(0.016);
                return ing.segs.slice();
            });
            expect(segs.some(Boolean)).toBe(false);
        });

        test('pressing every segment makes the ingredient fall', async ({ page }) => {
            const falling = await page.evaluate(() => {
                startGame();
                const ing = ingredientAt(0, 1);
                for (let s = 0; s < SEGS; s++) {
                    placeEntityOnFloor(player, ing.floor, ing.x + s * SEG_W + SEG_W / 2);
                    step(0.001);
                }
                return ing.falling;
            });
            expect(falling).toBe(true);
        });

        test('walking the length of an ingredient drops it', async ({ page }) => {
            const dropped = await page.evaluate(() => {
                startGame();
                enemies.length = 0;
                spawnTimer = 999;
                const ing = ingredientAt(0, 1);
                const startFloor = ing.floor;
                placeEntityOnFloor(player, startFloor, ing.x - 4);
                setDir(1, 0);
                for (let i = 0; i < 200; i++) {
                    step(0.016);
                    if (ing.falling || ing.floor !== startFloor) return true;
                }
                return false;
            });
            expect(dropped).toBe(true);
        });

        test('a falling ingredient descends', async ({ page }) => {
            const { before, after } = await page.evaluate(() => {
                startGame();
                const ing = ingredientAt(0, 1);
                dropIngredient(ing);
                const before = ing.y;
                for (let i = 0; i < 5; i++) step(0.016);
                return { before, after: ing.y };
            });
            expect(after).toBeGreaterThan(before);
        });

        test('dropping an ingredient scores points', async ({ page }) => {
            const gained = await page.evaluate(() => {
                startGame();
                const before = score;
                dropIngredient(ingredientAt(0, 1));
                return score - before;
            });
            expect(gained).toBeGreaterThan(0);
        });

        test('an ingredient landing on an empty floor rests and resets its segments', async ({ page }) => {
            const res = await page.evaluate(() => {
                startGame();
                spawnTimer = 999;
                // Clear burger 0's floor-2 layer so the layer above lands on bare girder.
                const below = ingredientAt(0, 2);
                below.floor = PLATE_FLOOR;
                below.landed = true;
                const ing = ingredientAt(0, 1);
                dropIngredient(ing);
                for (let i = 0; i < 120; i++) step(0.016);
                return { floor: ing.floor, falling: ing.falling, pressed: ing.segs.some(Boolean) };
            });
            expect(res.floor).toBe(2);
            expect(res.falling).toBe(false);
            expect(res.pressed).toBe(false);
        });

        test('landing on a resting ingredient chains both downward', async ({ page }) => {
            const chained = await page.evaluate(() => {
                startGame();
                spawnTimer = 999;
                const top = ingredientAt(0, 1);
                const below = ingredientAt(0, 2);
                dropIngredient(top);
                for (let i = 0; i < 60; i++) {
                    step(0.016);
                    if (below.falling) return true;
                }
                return false;
            });
            expect(chained).toBe(true);
        });

        test('an ingredient reaching the plate is landed', async ({ page }) => {
            const res = await page.evaluate(() => {
                startGame();
                spawnTimer = 999;
                const ing = ingredientAt(0, 4);
                dropIngredient(ing);
                for (let i = 0; i < 120; i++) step(0.016);
                return { landed: ing.landed, floor: ing.floor, plate: PLATE_FLOOR };
            });
            expect(res.landed).toBe(true);
            expect(res.floor).toBe(res.plate);
        });

        test('plated ingredients stack on top of each other', async ({ page }) => {
            const res = await page.evaluate(() => {
                startGame();
                spawnTimer = 999;
                const first = ingredientAt(0, 4);
                const second = ingredientAt(0, 3);
                dropIngredient(first);
                for (let i = 0; i < 120; i++) step(0.016);
                second.floor = PLATE_FLOOR - 1;
                second.y = FLOOR_YS[PLATE_FLOOR - 1];
                dropIngredient(second);
                for (let i = 0; i < 120; i++) step(0.016);
                return { a: first.y, b: second.y, aStack: first.stack, bStack: second.stack };
            });
            expect(res.aStack).toBe(0);
            expect(res.bStack).toBe(1);
            expect(res.b).toBeLessThan(res.a);
        });
    });

    // -----------------------------------------------------------------------
    // Enemies
    // -----------------------------------------------------------------------
    test.describe('enemies', () => {
        test('spawnEnemy places an enemy on a floor', async ({ page }) => {
            const e = await page.evaluate(() => {
                startGame();
                enemies.length = 0;
                const e = spawnEnemy({ floor: 2, x: 300 });
                return { count: enemies.length, floor: e.floor, y: e.y, floorY: FLOOR_YS[2] };
            });
            expect(e.count).toBe(1);
            expect(e.floor).toBe(2);
            expect(e.y).toBe(e.floorY);
        });

        test('an enemy walks toward the chef on the same floor', async ({ page }) => {
            const { before, after } = await page.evaluate(() => {
                startGame();
                enemies.length = 0;
                spawnTimer = 999;
                placeEntityOnFloor(player, 3, 100);
                const e = spawnEnemy({ floor: 3, x: 500 });
                const before = e.x;
                for (let i = 0; i < 30; i++) step(0.016);
                return { before, after: e.x };
            });
            expect(after).toBeLessThan(before);
        });

        test('an enemy on another floor heads for a ladder', async ({ page }) => {
            const moved = await page.evaluate(() => {
                startGame();
                enemies.length = 0;
                spawnTimer = 999;
                placeEntityOnFloor(player, PLATE_FLOOR, 320);
                const e = spawnEnemy({ floor: 0, x: 300 });
                const startY = e.y;
                for (let i = 0; i < 400; i++) {
                    step(0.016);
                    if (e.y > startY) return true;
                }
                return false;
            });
            expect(moved).toBe(true);
        });

        test('enemies move faster on later levels', async ({ page }) => {
            const { l1, l4 } = await page.evaluate(() => {
                startGame();
                level = 1;
                const l1 = enemySpeed();
                level = 4;
                const l4 = enemySpeed();
                return { l1, l4 };
            });
            expect(l4).toBeGreaterThan(l1);
        });

        test('enemies never outrun the chef', async ({ page }) => {
            const ok = await page.evaluate(() => {
                startGame();
                for (let l = 1; l <= 12; l++) {
                    level = l;
                    if (enemySpeed() >= PLAYER_SPEED) return false;
                }
                return true;
            });
            expect(ok).toBe(true);
        });

        test('touching an enemy costs a life and resets the chef', async ({ page }) => {
            const res = await page.evaluate(() => {
                startGame();
                enemies.length = 0;
                placeEntityOnFloor(player, 3, 300);
                spawnEnemy({ floor: 3, x: 302 });
                step(0.016);
                return {
                    lives, startLives: START_LIVES,
                    floor: player.floor, plate: PLATE_FLOOR,
                    enemies: enemies.length,
                };
            });
            expect(res.lives).toBe(res.startLives - 1);
            expect(res.floor).toBe(res.plate);
            expect(res.enemies).toBe(0);
        });

        test('losing the last life ends the game', async ({ page }) => {
            const s = await page.evaluate(() => {
                startGame();
                lives = 1;
                enemies.length = 0;
                placeEntityOnFloor(player, 3, 300);
                spawnEnemy({ floor: 3, x: 302 });
                step(0.016);
                return state;
            });
            expect(s).toBe('over');
        });

        test('losing a life keeps the ingredients where they are', async ({ page }) => {
            const landed = await page.evaluate(() => {
                startGame();
                spawnTimer = 999;
                const ing = ingredientAt(0, 4);
                dropIngredient(ing);
                for (let i = 0; i < 120; i++) step(0.016);
                enemies.length = 0;
                placeEntityOnFloor(player, 3, 300);
                spawnEnemy({ floor: 3, x: 302 });
                step(0.016);
                return ing.landed;
            });
            expect(landed).toBe(true);
        });

        test('a falling ingredient squashes an enemy and scores', async ({ page }) => {
            const res = await page.evaluate(() => {
                startGame();
                enemies.length = 0;
                spawnTimer = 999;
                placeEntityOnFloor(player, PLATE_FLOOR, LADDER_XS[0]);
                const ing = ingredientAt(0, 1);
                spawnEnemy({ floor: 2, x: ing.x + 40 });
                dropIngredient(ing);
                const before = score;
                for (let i = 0; i < 60; i++) step(0.016);
                return { enemies: enemies.length, gained: score - before };
            });
            expect(res.enemies).toBe(0);
            expect(res.gained).toBeGreaterThanOrEqual(100);
        });
    });

    // -----------------------------------------------------------------------
    // Pepper
    // -----------------------------------------------------------------------
    test.describe('pepper', () => {
        test('using pepper spends one and makes a cloud', async ({ page }) => {
            const res = await page.evaluate(() => {
                startGame();
                const before = peppers;
                usePepper();
                return { before, after: peppers, clouds: sprays.length };
            });
            expect(res.after).toBe(res.before - 1);
            expect(res.clouds).toBe(1);
        });

        test('pepper stuns a nearby enemy', async ({ page }) => {
            const stun = await page.evaluate(() => {
                startGame();
                enemies.length = 0;
                spawnTimer = 999;
                placeEntityOnFloor(player, 3, 300);
                player.facing = 1;
                const e = spawnEnemy({ floor: 3, x: 322 });
                usePepper();
                step(0.001);
                return e.stun;
            });
            expect(stun).toBeGreaterThan(0);
        });

        test('a stunned enemy holds still', async ({ page }) => {
            const { before, after } = await page.evaluate(() => {
                startGame();
                enemies.length = 0;
                spawnTimer = 999;
                placeEntityOnFloor(player, 3, 100);
                const e = spawnEnemy({ floor: 3, x: 500 });
                e.stun = 5;
                const before = e.x;
                for (let i = 0; i < 30; i++) step(0.016);
                return { before, after: e.x };
            });
            expect(after).toBe(before);
        });

        test('a stun wears off', async ({ page }) => {
            const stun = await page.evaluate(() => {
                startGame();
                enemies.length = 0;
                spawnTimer = 999;
                placeEntityOnFloor(player, 3, 100);
                const e = spawnEnemy({ floor: 3, x: 500 });
                e.stun = 0.1;
                for (let i = 0; i < 30; i++) step(0.016);
                return e.stun;
            });
            expect(stun).toBe(0);
        });

        test('pepper cannot be used when the shaker is empty', async ({ page }) => {
            const res = await page.evaluate(() => {
                startGame();
                peppers = 0;
                sprays.length = 0;
                usePepper();
                return { peppers, clouds: sprays.length };
            });
            expect(res.peppers).toBe(0);
            expect(res.clouds).toBe(0);
        });

        test('clouds fade away', async ({ page }) => {
            const clouds = await page.evaluate(() => {
                startGame();
                spawnTimer = 999;
                usePepper();
                for (let i = 0; i < 120; i++) step(0.016);
                return sprays.length;
            });
            expect(clouds).toBe(0);
        });
    });

    // -----------------------------------------------------------------------
    // Levels
    // -----------------------------------------------------------------------
    test.describe('levels', () => {
        test('completing a burger awards a bonus', async ({ page }) => {
            const done = await page.evaluate(() => {
                startGame();
                for (let pass = 0; pass < 60; pass++) {
                    enemies.length = 0;
                    const mine = ingredients.filter((i) => i.burger === 0);
                    if (mine.every((i) => i.landed)) break;
                    for (const i of mine) if (!i.falling && !i.landed) dropIngredient(i);
                    for (let s = 0; s < 40; s++) step(0.016);
                }
                return burgersCompleted;
            });
            expect(done).toBeGreaterThanOrEqual(1);
        });

        test('plating every ingredient advances the level and rebuilds the board', async ({ page }) => {
            const res = await page.evaluate(() => {
                startGame();
                for (let pass = 0; pass < 200; pass++) {
                    enemies.length = 0;
                    if (level > 1) break;
                    for (const i of ingredients) if (!i.falling && !i.landed) dropIngredient(i);
                    for (let s = 0; s < 20; s++) step(0.016);
                }
                return {
                    level,
                    landed: ingredients.filter((i) => i.landed).length,
                    total: ingredients.length,
                };
            });
            expect(res.level).toBe(2);
            expect(res.landed).toBe(0);
            expect(res.total).toBe(16);
        });

        test('a new level refills the pepper shaker', async ({ page }) => {
            const res = await page.evaluate(() => {
                startGame();
                peppers = 0;
                for (let pass = 0; pass < 200; pass++) {
                    enemies.length = 0;
                    if (level > 1) break;
                    for (const i of ingredients) if (!i.falling && !i.landed) dropIngredient(i);
                    for (let s = 0; s < 20; s++) step(0.016);
                }
                return { peppers, startPeppers: START_PEPPERS };
            });
            expect(res.peppers).toBe(res.startPeppers);
        });
    });

    // -----------------------------------------------------------------------
    // Pause, restart, scoring
    // -----------------------------------------------------------------------
    test.describe('pause and restart', () => {
        test('pausing freezes a falling ingredient', async ({ page }) => {
            const { before, after } = await page.evaluate(() => {
                startGame();
                const ing = ingredientAt(0, 1);
                dropIngredient(ing);
                togglePause();
                const before = ing.y;
                for (let i = 0; i < 10; i++) step(0.016);
                return { before, after: ing.y };
            });
            expect(after).toBe(before);
        });

        test('resuming lets it fall again', async ({ page }) => {
            const moved = await page.evaluate(() => {
                startGame();
                const ing = ingredientAt(0, 1);
                dropIngredient(ing);
                togglePause();
                togglePause();
                const before = ing.y;
                for (let i = 0; i < 10; i++) step(0.016);
                return ing.y > before;
            });
            expect(moved).toBe(true);
        });

        test('restart resets score, level, lives and the board', async ({ page }) => {
            const res = await page.evaluate(() => {
                startGame();
                score = 5000;
                level = 4;
                lives = 1;
                dropIngredient(ingredientAt(0, 1));
                spawnEnemy({ floor: 0, x: 100 });
                endGame();
                startGame();
                return {
                    score, level, lives, state, startLives: START_LIVES,
                    enemies: enemies.length,
                    falling: ingredients.filter((i) => i.falling).length,
                    landed: ingredients.filter((i) => i.landed).length,
                };
            });
            expect(res.score).toBe(0);
            expect(res.level).toBe(1);
            expect(res.lives).toBe(res.startLives);
            expect(res.state).toBe('running');
            expect(res.enemies).toBe(0);
            expect(res.falling).toBe(0);
            expect(res.landed).toBe(0);
        });

        test('game over shows the overlay with Play Again', async ({ page }) => {
            await page.evaluate(() => { startGame(); endGame(); });
            await expect(page.locator('#overlay')).toHaveClass(/visible/);
            await expect(page.locator('#btn-start')).toHaveText('Play Again');
        });

        test('best score updates and persists', async ({ page }) => {
            await page.evaluate(() => { startGame(); score = 7350; updateHud(); endGame(); });
            await expect(page.locator('#best')).toHaveText('7350');
            const stored = await page.evaluate(() => window.localStorage.getItem('burgertime-best'));
            expect(parseInt(stored, 10)).toBe(7350);
        });

        test('best score is not lowered by a worse run', async ({ page }) => {
            await page.evaluate(() => window.localStorage.setItem('burgertime-best', '99000'));
            await page.reload();
            await page.evaluate(() => { startGame(); score = 10; updateHud(); endGame(); });
            await expect(page.locator('#best')).toHaveText('99000');
        });

        test('the HUD tracks score, level, lives and peppers', async ({ page }) => {
            await page.evaluate(() => {
                startGame();
                score = 1234;
                level = 3;
                lives = 2;
                peppers = 1;
                updateHud();
            });
            await expect(page.locator('#score')).toHaveText('1234');
            await expect(page.locator('#level')).toHaveText('3');
            await expect(page.locator('#lives')).toHaveText('2');
            await expect(page.locator('#peppers')).toHaveText('1');
        });
    });
});
