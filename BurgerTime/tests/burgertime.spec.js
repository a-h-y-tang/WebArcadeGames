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

        test('canvas is 600x480', async ({ page }) => {
            const canvas = page.locator('#canvas');
            await expect(canvas).toHaveAttribute('width', '600');
            await expect(canvas).toHaveAttribute('height', '480');
        });

        test('state is idle before starting', async ({ page }) => {
            expect(await page.evaluate(() => state)).toBe('idle');
        });

        test('HUD starts at score 0, 3 lives, level 1', async ({ page }) => {
            await expect(page.locator('#score')).toHaveText('0');
            await expect(page.locator('#lives')).toHaveText('3');
            await expect(page.locator('#level')).toHaveText('1');
            await expect(page.locator('#best')).toHaveText('0');
        });

        test('the level is built with 4 stacks of 4 ingredients', async ({ page }) => {
            const info = await page.evaluate(() => ({
                total: ingredients.length,
                stacks: new Set(ingredients.map((i) => i.stack)).size,
                layers: LAYERS,
            }));
            expect(info.total).toBe(16);
            expect(info.stacks).toBe(4);
            expect(info.layers).toBe(4);
        });

        test('no ingredient starts on a plate', async ({ page }) => {
            expect(await page.evaluate(() => ingredients.filter((i) => i.onPlate).length)).toBe(0);
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

        test('a fresh game has 3 lives, level 1, score 0 and full pepper', async ({ page }) => {
            const s = await page.evaluate(() => {
                startGame();
                return { lives, level, score, pepper: player.pepper, full: START_PEPPER };
            });
            expect(s.lives).toBe(3);
            expect(s.level).toBe(1);
            expect(s.score).toBe(0);
            expect(s.pepper).toBe(s.full);
        });

        test('the chef starts on the bottom floor', async ({ page }) => {
            const onBottom = await page.evaluate(() => {
                startGame();
                return player.y === FLOOR_YS[FLOOR_YS.length - 1];
            });
            expect(onBottom).toBe(true);
        });

        test('enemies spawn when the game starts', async ({ page }) => {
            expect(await page.evaluate(() => { startGame(); return enemies.length; })).toBeGreaterThan(0);
        });
    });

    // -----------------------------------------------------------------------
    // Chef movement
    // -----------------------------------------------------------------------
    test.describe('chef movement', () => {
        test('walking right increases x', async ({ page }) => {
            const { before, after } = await page.evaluate(() => {
                startGame();
                setPlayerPos(300, FLOOR_YS[4]);
                const before = player.x;
                movePlayer(1, 0);
                for (let i = 0; i < 20; i++) step(0.016);
                return { before, after: player.x };
            });
            expect(after).toBeGreaterThan(before);
        });

        test('walking left decreases x', async ({ page }) => {
            const { before, after } = await page.evaluate(() => {
                startGame();
                setPlayerPos(300, FLOOR_YS[4]);
                const before = player.x;
                movePlayer(-1, 0);
                for (let i = 0; i < 20; i++) step(0.016);
                return { before, after: player.x };
            });
            expect(after).toBeLessThan(before);
        });

        test('the chef cannot walk off either edge', async ({ page }) => {
            const res = await page.evaluate(() => {
                startGame();
                setPlayerPos(40, FLOOR_YS[4]);
                movePlayer(-1, 0);
                for (let i = 0; i < 400; i++) step(0.016);
                const left = player.x;
                setPlayerPos(560, FLOOR_YS[4]);
                movePlayer(1, 0);
                for (let i = 0; i < 400; i++) step(0.016);
                return { left, right: player.x, w: CANVAS_W };
            });
            expect(res.left).toBeGreaterThanOrEqual(0);
            expect(res.right).toBeLessThanOrEqual(res.w);
        });

        test('the chef cannot climb where there is no ladder', async ({ page }) => {
            const { before, after } = await page.evaluate(() => {
                startGame();
                // midway between two ladders
                const x = (LADDER_XS[0] + LADDER_XS[1]) / 2;
                setPlayerPos(x, FLOOR_YS[4]);
                const before = player.y;
                movePlayer(0, -1);
                for (let i = 0; i < 40; i++) step(0.016);
                return { before, after: player.y };
            });
            expect(after).toBe(before);
        });

        test('the chef climbs up a ladder', async ({ page }) => {
            const res = await page.evaluate(() => {
                startGame();
                setPlayerPos(LADDER_XS[1], FLOOR_YS[4]);
                movePlayer(0, -1);
                for (let i = 0; i < 40; i++) step(0.016);
                return { y: player.y, onLadder: player.onLadder, floorY: FLOOR_YS[4] };
            });
            expect(res.y).toBeLessThan(res.floorY);
            expect(res.onLadder).toBe(true);
        });

        test('climbing far enough lands on the floor above', async ({ page }) => {
            const y = await page.evaluate(() => {
                startGame();
                setPlayerPos(LADDER_XS[1], FLOOR_YS[4]);
                movePlayer(0, -1);
                for (let i = 0; i < 400; i++) step(0.016);
                movePlayer(0, 0);
                for (let i = 0; i < 5; i++) step(0.016);
                return player.y;
            });
            expect(y).toBeLessThanOrEqual(60);
        });

        test('the chef snaps onto a ladder when close to it', async ({ page }) => {
            const x = await page.evaluate(() => {
                startGame();
                setPlayerPos(LADDER_XS[2] - 5, FLOOR_YS[4]);
                movePlayer(0, -1);
                for (let i = 0; i < 10; i++) step(0.016);
                return player.x;
            });
            expect(x).toBe(await page.evaluate(() => LADDER_XS[2]));
        });

        test('the chef cannot climb above the top floor', async ({ page }) => {
            const y = await page.evaluate(() => {
                startGame();
                setPlayerPos(LADDER_XS[0], FLOOR_YS[0]);
                movePlayer(0, -1);
                for (let i = 0; i < 200; i++) step(0.016);
                return player.y;
            });
            expect(y).toBe(await page.evaluate(() => FLOOR_YS[0]));
        });

        test('the chef cannot climb below the bottom floor', async ({ page }) => {
            const y = await page.evaluate(() => {
                startGame();
                setPlayerPos(LADDER_XS[0], FLOOR_YS[4]);
                movePlayer(0, 1);
                for (let i = 0; i < 200; i++) step(0.016);
                return player.y;
            });
            expect(y).toBe(await page.evaluate(() => FLOOR_YS[4]));
        });

        test('ArrowRight moves the chef right', async ({ page }) => {
            await page.evaluate(() => { startGame(); setPlayerPos(300, FLOOR_YS[4]); });
            const before = await page.evaluate(() => player.x);
            await page.keyboard.down('ArrowRight');
            await page.evaluate(() => { for (let i = 0; i < 20; i++) step(0.016); });
            await page.keyboard.up('ArrowRight');
            const after = await page.evaluate(() => player.x);
            expect(after).toBeGreaterThan(before);
        });

        test('nothing moves while the game is idle', async ({ page }) => {
            const { before, after } = await page.evaluate(() => {
                const before = player.x;
                movePlayer(1, 0);
                for (let i = 0; i < 20; i++) step(0.016);
                return { before, after: player.x };
            });
            expect(after).toBe(before);
        });
    });

    // -----------------------------------------------------------------------
    // Ingredients
    // -----------------------------------------------------------------------
    test.describe('ingredients', () => {
        test('walking over every segment drops the ingredient one floor', async ({ page }) => {
            const res = await page.evaluate(() => {
                startGame();
                enemies.length = 0;
                const ing = ingredients.find((i) => i.stack === 0 && i.floor === 3);
                const startFloor = ing.floor;
                setPlayerPos(ing.x - 12, FLOOR_YS[ing.floor]);
                movePlayer(1, 0);
                for (let i = 0; i < 200 && player.x < ing.x + ING_W + 12; i++) step(0.016);
                movePlayer(0, 0);
                for (let i = 0; i < 100; i++) step(0.016);
                return { startFloor, endFloor: ing.floor, onPlate: ing.onPlate };
            });
            expect(res.startFloor).toBe(3);
            expect(res.onPlate).toBe(true);
        });

        test('walking over only part of an ingredient does not drop it', async ({ page }) => {
            const res = await page.evaluate(() => {
                startGame();
                enemies.length = 0;
                const ing = ingredients.find((i) => i.stack === 1 && i.floor === 0);
                setPlayerPos(ing.x - 12, FLOOR_YS[ing.floor]);
                movePlayer(1, 0);
                for (let i = 0; i < 200 && player.x < ing.x + SEG_W * 2; i++) step(0.016);
                movePlayer(0, 0);
                for (let i = 0; i < 20; i++) step(0.016);
                return {
                    floor: ing.floor,
                    falling: ing.falling,
                    stepped: ing.stepped.filter(Boolean).length,
                };
            });
            expect(res.floor).toBe(0);
            expect(res.falling).toBe(false);
            expect(res.stepped).toBeGreaterThan(0);
            expect(res.stepped).toBeLessThan(4);
        });

        test('a dropped ingredient rests on the first free floor below', async ({ page }) => {
            const res = await page.evaluate(() => {
                startGame();
                enemies.length = 0;
                // clear the girder directly below so nothing is pushed along
                const below = ingredients.find((i) => i.stack === 2 && i.floor === 1);
                ingredients.splice(ingredients.indexOf(below), 1);
                const ing = ingredients.find((i) => i.stack === 2 && i.floor === 0);
                dropIngredient(ing);
                const falling = ing.falling;
                for (let i = 0; i < 200; i++) step(0.016);
                return { falling, floor: ing.floor, y: ing.y, target: FLOOR_YS[1] };
            });
            expect(res.falling).toBe(true);
            expect(res.floor).toBe(1);
            expect(res.y).toBe(res.target);
        });

        test('dropping an ingredient scores points', async ({ page }) => {
            const gained = await page.evaluate(() => {
                startGame();
                enemies.length = 0;
                const before = score;
                dropIngredient(ingredients.find((i) => i.stack === 2 && i.floor === 0));
                return score - before;
            });
            expect(gained).toBe(await page.evaluate(() => DROP_POINTS));
        });

        test('a falling ingredient pushes the one it lands on', async ({ page }) => {
            const res = await page.evaluate(() => {
                startGame();
                enemies.length = 0;
                const upper = ingredients.find((i) => i.stack === 0 && i.floor === 2);
                const lower = ingredients.find((i) => i.stack === 0 && i.floor === 3);
                dropIngredient(upper);
                for (let i = 0; i < 400; i++) step(0.016);
                return { upperPlate: upper.onPlate, lowerPlate: lower.onPlate };
            });
            expect(res.lowerPlate).toBe(true);
            expect(res.upperPlate).toBe(true);
        });

        test('an ingredient that reaches the plate stops there', async ({ page }) => {
            const res = await page.evaluate(() => {
                startGame();
                enemies.length = 0;
                const ing = ingredients.find((i) => i.stack === 3 && i.floor === 3);
                dropIngredient(ing);
                for (let i = 0; i < 400; i++) step(0.016);
                return { onPlate: ing.onPlate, falling: ing.falling, y: ing.y, plateY: PLATE_Y };
            });
            expect(res.onPlate).toBe(true);
            expect(res.falling).toBe(false);
            expect(res.y).toBeLessThanOrEqual(res.plateY);
            expect(res.y).toBeGreaterThan(res.plateY - 40);
        });

        test('dropping the top layer cascades the whole burger onto the plate', async ({ page }) => {
            const res = await page.evaluate(() => {
                startGame();
                enemies.length = 0;
                dropIngredient(ingredients.find((i) => i.stack === 1 && i.tier === 0));
                for (let i = 0; i < 400; i++) step(0.016);
                const stack = ingredients.filter((i) => i.stack === 1).sort((a, b) => b.tier - a.tier);
                return {
                    plated: stack.filter((i) => i.onPlate).length,
                    ys: stack.map((i) => i.y),
                    plateY: PLATE_Y,
                    ingH: ING_H,
                };
            });
            expect(res.plated).toBe(4);
            // bottom bun lands first and sits lowest; each layer stacks one height up
            expect(res.ys).toEqual([
                res.plateY,
                res.plateY - res.ingH,
                res.plateY - res.ingH * 2,
                res.plateY - res.ingH * 3,
            ]);
        });

        test('a clump that lands on a bare girder piles up there', async ({ page }) => {
            const res = await page.evaluate(() => {
                startGame();
                enemies.length = 0;
                // clear stack 3 below floor 1 so the clump has somewhere bare to land
                for (const doomed of ingredients.filter((i) => i.stack === 3 && i.floor >= 2)) {
                    ingredients.splice(ingredients.indexOf(doomed), 1);
                }
                dropIngredient(ingredients.find((i) => i.stack === 3 && i.tier === 0));
                for (let i = 0; i < 200; i++) step(0.016);
                const left = ingredients.filter((i) => i.stack === 3);
                return {
                    floors: left.map((i) => i.floor),
                    falling: left.some((i) => i.falling),
                    ys: left.sort((a, b) => b.tier - a.tier).map((i) => i.y),
                    target: FLOOR_YS[2],
                    ingH: ING_H,
                };
            });
            expect(res.floors).toEqual([2, 2]);
            expect(res.falling).toBe(false);
            expect(res.ys).toEqual([res.target, res.target - res.ingH]);
        });

        test('reaching the plate scores plate points', async ({ page }) => {
            const gained = await page.evaluate(() => {
                startGame();
                enemies.length = 0;
                const ing = ingredients.find((i) => i.stack === 3 && i.floor === 3);
                const before = score;
                dropIngredient(ing);
                for (let i = 0; i < 400; i++) step(0.016);
                return score - before;
            });
            expect(gained).toBe(await page.evaluate(() => DROP_POINTS + PLATE_POINTS));
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
                spawnEnemy({ x: 200, y: FLOOR_YS[4] });
                return { count: enemies.length, x: enemies[0].x, y: enemies[0].y, floorY: FLOOR_YS[4] };
            });
            expect(res.count).toBe(1);
            expect(res.x).toBe(200);
            expect(res.y).toBe(res.floorY);
        });

        test('an enemy walks toward the chef on the same floor', async ({ page }) => {
            const res = await page.evaluate(() => {
                startGame();
                enemies.length = 0;
                setPlayerPos(120, FLOOR_YS[4]);
                movePlayer(0, 0);
                const e = spawnEnemy({ x: 500, y: FLOOR_YS[4] });
                const before = e.x;
                for (let i = 0; i < 60; i++) step(0.016);
                return { before, after: e.x };
            });
            expect(res.after).toBeLessThan(res.before);
        });

        test('an enemy climbs toward a chef on another floor', async ({ page }) => {
            const res = await page.evaluate(() => {
                startGame();
                enemies.length = 0;
                setPlayerPos(LADDER_XS[0], FLOOR_YS[1]);
                movePlayer(0, 0);
                const e = spawnEnemy({ x: LADDER_XS[0], y: FLOOR_YS[4] });
                const before = e.y;
                for (let i = 0; i < 300; i++) step(0.016);
                return { before, after: e.y };
            });
            expect(res.after).toBeLessThan(res.before);
        });

        test('touching an enemy costs a life', async ({ page }) => {
            const res = await page.evaluate(() => {
                startGame();
                enemies.length = 0;
                setPlayerPos(300, FLOOR_YS[4]);
                spawnEnemy({ x: 302, y: FLOOR_YS[4] });
                const before = lives;
                for (let i = 0; i < 10; i++) step(0.016);
                return { before, after: lives };
            });
            expect(res.after).toBe(res.before - 1);
        });

        test('losing a life resets the chef to the start spot', async ({ page }) => {
            const res = await page.evaluate(() => {
                startGame();
                enemies.length = 0;
                setPlayerPos(120, FLOOR_YS[1]);
                spawnEnemy({ x: 122, y: FLOOR_YS[1] });
                for (let i = 0; i < 10; i++) step(0.016);
                return { x: player.x, y: player.y };
            });
            expect(res.y).toBe(await page.evaluate(() => FLOOR_YS[4]));
            expect(res.x).toBe(await page.evaluate(() => CANVAS_W / 2));
        });

        test('a stunned enemy does not move and is harmless', async ({ page }) => {
            const res = await page.evaluate(() => {
                startGame();
                enemies.length = 0;
                setPlayerPos(300, FLOOR_YS[4]);
                const e = spawnEnemy({ x: 302, y: FLOOR_YS[4] });
                e.stun = STUN_TIME;
                const before = { x: e.x, lives };
                for (let i = 0; i < 30; i++) step(0.016);
                return { before, x: e.x, lives };
            });
            expect(res.x).toBe(res.before.x);
            expect(res.lives).toBe(res.before.lives);
        });

        test('a falling ingredient squashes an enemy underneath it', async ({ page }) => {
            const res = await page.evaluate(() => {
                startGame();
                enemies.length = 0;
                const ing = ingredients.find((i) => i.stack === 2 && i.floor === 2);
                setPlayerPos(40, FLOOR_YS[4]);
                spawnEnemy({ x: ing.x + ING_W / 2, y: FLOOR_YS[3] });
                const before = score;
                dropIngredient(ing);
                for (let i = 0; i < 120; i++) step(0.016);
                return { alive: enemies.filter((e) => !e.squashed).length, gained: score - before };
            });
            expect(res.alive).toBe(0);
            expect(res.gained).toBeGreaterThanOrEqual(await page.evaluate(() => DROP_POINTS + SQUASH_BASE));
        });

        test('squashing two enemies in one fall scores more than one', async ({ page }) => {
            const res = await page.evaluate(() => {
                const squashRun = (n) => {
                    startGame();
                    enemies.length = 0;
                    setPlayerPos(40, FLOOR_YS[4]);
                    const ing = ingredients.find((i) => i.stack === 2 && i.floor === 2);
                    for (let k = 0; k < n; k++) {
                        spawnEnemy({ x: ing.x + 20 + k * 20, y: FLOOR_YS[3] });
                    }
                    const before = score;
                    dropIngredient(ing);
                    for (let i = 0; i < 120; i++) step(0.016);
                    return score - before;
                };
                return { one: squashRun(1), two: squashRun(2) };
            });
            expect(res.two).toBeGreaterThan(res.one);
        });

        test('enemies respawn after being squashed', async ({ page }) => {
            const count = await page.evaluate(() => {
                startGame();
                enemies.length = 0;
                setPlayerPos(40, FLOOR_YS[4]);
                const ing = ingredients.find((i) => i.stack === 2 && i.floor === 2);
                spawnEnemy({ x: ing.x + ING_W / 2, y: FLOOR_YS[3] });
                dropIngredient(ing);
                for (let i = 0; i < 600; i++) step(0.016);
                return enemies.filter((e) => !e.squashed).length;
            });
            expect(count).toBeGreaterThan(0);
        });
    });

    // -----------------------------------------------------------------------
    // Pepper
    // -----------------------------------------------------------------------
    test.describe('pepper', () => {
        test('throwing pepper uses one shaker', async ({ page }) => {
            const res = await page.evaluate(() => {
                startGame();
                const before = player.pepper;
                const ok = throwPepper();
                return { before, after: player.pepper, ok };
            });
            expect(res.ok).toBe(true);
            expect(res.after).toBe(res.before - 1);
        });

        test('pepper cannot be thrown with an empty shaker', async ({ page }) => {
            const res = await page.evaluate(() => {
                startGame();
                player.pepper = 0;
                return { ok: throwPepper(), clouds: peppers.length };
            });
            expect(res.ok).toBe(false);
            expect(res.clouds).toBe(0);
        });

        test('pepper stuns an enemy standing in front of the chef', async ({ page }) => {
            const stun = await page.evaluate(() => {
                startGame();
                enemies.length = 0;
                setPlayerPos(300, FLOOR_YS[4]);
                movePlayer(1, 0);
                step(0.016);
                const e = spawnEnemy({ x: 322, y: FLOOR_YS[4] });
                throwPepper();
                step(0.016);
                return e.stun;
            });
            expect(stun).toBeGreaterThan(0);
        });

        test('pepper clouds fade away', async ({ page }) => {
            const clouds = await page.evaluate(() => {
                startGame();
                throwPepper();
                for (let i = 0; i < 120; i++) step(0.016);
                return peppers.length;
            });
            expect(clouds).toBe(0);
        });

        test('a stun wears off over time', async ({ page }) => {
            const res = await page.evaluate(() => {
                startGame();
                enemies.length = 0;
                setPlayerPos(40, FLOOR_YS[0]);
                const e = spawnEnemy({ x: 560, y: FLOOR_YS[4] });
                e.stun = 0.2;
                for (let i = 0; i < 60; i++) step(0.016);
                return e.stun;
            });
            expect(res).toBeLessThanOrEqual(0);
        });

        test('the Space key throws pepper while running', async ({ page }) => {
            await page.evaluate(() => startGame());
            const before = await page.evaluate(() => player.pepper);
            await page.keyboard.press('Space');
            const after = await page.evaluate(() => player.pepper);
            expect(after).toBe(before - 1);
        });
    });

    // -----------------------------------------------------------------------
    // Level flow
    // -----------------------------------------------------------------------
    test.describe('levels', () => {
        test('plating every ingredient clears the level', async ({ page }) => {
            const res = await page.evaluate(() => {
                startGame();
                enemies.length = 0;
                for (let guard = 0; guard < 100 && ingredients.some((i) => !i.onPlate); guard++) {
                    for (const ing of ingredients) if (!ing.onPlate && !ing.falling) dropIngredient(ing);
                    for (let i = 0; i < 100; i++) step(0.016);
                }
                return { state, level, plated: ingredients.filter((i) => i.onPlate).length };
            });
            expect(res.plated).toBe(16);
            expect(res.state).toBe('levelclear');
            expect(res.level).toBe(1);
        });

        test('the next level starts with a fresh board', async ({ page }) => {
            const res = await page.evaluate(() => {
                startGame();
                enemies.length = 0;
                for (let guard = 0; guard < 100 && ingredients.some((i) => !i.onPlate); guard++) {
                    for (const ing of ingredients) if (!ing.onPlate && !ing.falling) dropIngredient(ing);
                    for (let i = 0; i < 100; i++) step(0.016);
                }
                for (let i = 0; i < 300; i++) step(0.016);
                return { state, level, plated: ingredients.filter((i) => i.onPlate).length };
            });
            expect(res.level).toBe(2);
            expect(res.state).toBe('running');
            expect(res.plated).toBe(0);
        });

        test('enemies move faster on later levels', async ({ page }) => {
            const res = await page.evaluate(() => {
                startGame();
                const l1 = enemySpeed();
                level = 4;
                return { l1, l4: enemySpeed() };
            });
            expect(res.l4).toBeGreaterThan(res.l1);
        });

        test('clearing a level awards a bonus', async ({ page }) => {
            const gained = await page.evaluate(() => {
                startGame();
                enemies.length = 0;
                score = 0;
                for (let guard = 0; guard < 100 && ingredients.some((i) => !i.onPlate); guard++) {
                    for (const ing of ingredients) if (!ing.onPlate && !ing.falling) dropIngredient(ing);
                    for (let i = 0; i < 100; i++) step(0.016);
                }
                return score;
            });
            const expected = await page.evaluate(() => 16 * (DROP_POINTS + PLATE_POINTS) + LEVEL_BONUS);
            expect(gained).toBeGreaterThanOrEqual(expected);
        });
    });

    // -----------------------------------------------------------------------
    // Lives, pause and game over
    // -----------------------------------------------------------------------
    test.describe('game flow', () => {
        test('losing every life ends the game', async ({ page }) => {
            const res = await page.evaluate(() => {
                startGame();
                loseLife();
                loseLife();
                loseLife();
                return { state, lives };
            });
            expect(res.state).toBe('over');
            expect(res.lives).toBe(0);
        });

        test('game over shows the overlay with the score', async ({ page }) => {
            await page.evaluate(() => {
                startGame();
                score = 1234;
                endGame();
            });
            await expect(page.locator('#overlay')).toHaveClass(/visible/);
            await expect(page.locator('#overlay-score')).toContainText('1234');
        });

        test('the HUD tracks score, lives and level', async ({ page }) => {
            await page.evaluate(() => {
                startGame();
                score = 950;
                lives = 2;
                level = 3;
                updateHud();
            });
            await expect(page.locator('#score')).toHaveText('950');
            await expect(page.locator('#lives')).toHaveText('2');
            await expect(page.locator('#level')).toHaveText('3');
        });

        test('P pauses and resumes', async ({ page }) => {
            await page.evaluate(() => startGame());
            await page.keyboard.press('p');
            expect(await page.evaluate(() => state)).toBe('paused');
            await page.keyboard.press('p');
            expect(await page.evaluate(() => state)).toBe('running');
        });

        test('nothing simulates while paused', async ({ page }) => {
            const res = await page.evaluate(() => {
                startGame();
                setPlayerPos(300, FLOOR_YS[4]);
                togglePause();
                movePlayer(1, 0);
                for (let i = 0; i < 20; i++) step(0.016);
                return player.x;
            });
            expect(res).toBe(300);
        });

        test('best score updates on game over', async ({ page }) => {
            await page.evaluate(() => {
                startGame();
                score = 777;
                endGame();
            });
            await expect(page.locator('#best')).toHaveText('777');
        });

        test('best score persists to localStorage', async ({ page }) => {
            await page.evaluate(() => {
                startGame();
                score = 888;
                endGame();
            });
            expect(await page.evaluate(() => window.localStorage.getItem('burgertime-best'))).toBe('888');
        });

        test('Space restarts after a game over', async ({ page }) => {
            await page.evaluate(() => {
                startGame();
                score = 300;
                endGame();
            });
            await page.keyboard.press('Space');
            const res = await page.evaluate(() => ({ state, score, lives }));
            expect(res.state).toBe('running');
            expect(res.score).toBe(0);
            expect(res.lives).toBe(3);
        });

        test('the canvas keeps rendering without errors', async ({ page }) => {
            const errors = [];
            page.on('pageerror', (e) => errors.push(e.message));
            await page.evaluate(() => startGame());
            await page.waitForTimeout(400);
            expect(errors).toEqual([]);
        });
    });
});
