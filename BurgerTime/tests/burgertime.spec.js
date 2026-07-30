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

        test('score, lives and level start at their defaults', async ({ page }) => {
            await expect(page.locator('#score')).toHaveText('0');
            await expect(page.locator('#lives')).toHaveText('3');
            await expect(page.locator('#level')).toHaveText('1');
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

        test('no ingredients or enemies before starting', async ({ page }) => {
            const counts = await page.evaluate(() => ({
                ingredients: ingredients.length,
                enemies: enemies.length,
            }));
            expect(counts).toEqual({ ingredients: 0, enemies: 0 });
        });

        test('best score loads from localStorage', async ({ page }) => {
            await page.evaluate(() => window.localStorage.setItem('burgertime-best', '7400'));
            await page.reload();
            await expect(page.locator('#best')).toHaveText('7400');
        });
    });

    // -----------------------------------------------------------------------
    // Level geometry
    // -----------------------------------------------------------------------
    test.describe('layout', () => {
        test('floors are ordered top to bottom', async ({ page }) => {
            const ys = await page.evaluate(() =>
                Array.from({ length: FLOOR_COUNT }, (_, i) => floorY(i))
            );
            for (let i = 1; i < ys.length; i++) {
                expect(ys[i]).toBeGreaterThan(ys[i - 1]);
            }
        });

        test('the plate row sits below the lowest floor', async ({ page }) => {
            const { plate, lowest } = await page.evaluate(() => ({
                plate: floorY(PLATE_FLOOR),
                lowest: floorY(FLOOR_COUNT - 1),
            }));
            expect(plate).toBeGreaterThan(lowest);
        });

        test('every ladder is inside the canvas', async ({ page }) => {
            const ladders = await page.evaluate(() => LADDER_XS.slice());
            expect(ladders.length).toBeGreaterThan(0);
            for (const x of ladders) {
                expect(x).toBeGreaterThan(0);
                expect(x).toBeLessThan(640);
            }
        });

        test('burger columns do not overlap the ladders', async ({ page }) => {
            const clear = await page.evaluate(() =>
                BURGER_X.every((x0) =>
                    LADDER_XS.every((lx) => lx + LADDER_W / 2 < x0 || lx - LADDER_W / 2 > x0 + ING_W)
                )
            );
            expect(clear).toBe(true);
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

        test('a new game starts on level 1 with 3 lives and full pepper', async ({ page }) => {
            const s = await page.evaluate(() => {
                startGame();
                return { level, lives, score, pepper };
            });
            expect(s).toEqual({ level: 1, lives: 3, score: 0, pepper: 5 });
        });

        test('the level is stocked with a full set of ingredients', async ({ page }) => {
            const n = await page.evaluate(() => {
                startGame();
                return ingredients.length;
            });
            expect(n).toBe(9);
        });

        test('no ingredient starts on a plate', async ({ page }) => {
            const plated = await page.evaluate(() => {
                startGame();
                return ingredients.filter((i) => i.floor === PLATE_FLOOR).length;
            });
            expect(plated).toBe(0);
        });

        test('the chef starts on the bottom floor', async ({ page }) => {
            const ok = await page.evaluate(() => {
                startGame();
                return chef.y === floorY(FLOOR_COUNT - 1);
            });
            expect(ok).toBe(true);
        });

        test('enemies are on the board at the start', async ({ page }) => {
            const n = await page.evaluate(() => {
                startGame();
                return enemies.length;
            });
            expect(n).toBeGreaterThan(0);
        });
    });

    // -----------------------------------------------------------------------
    // Chef movement
    // -----------------------------------------------------------------------
    test.describe('chef movement', () => {
        test('walking right increases x', async ({ page }) => {
            const { before, after } = await page.evaluate(() => {
                startGame();
                setChefPos(300, floorY(4));
                const before = chef.x;
                moveChef(1, 0);
                for (let i = 0; i < 10; i++) step(0.016);
                return { before, after: chef.x };
            });
            expect(after).toBeGreaterThan(before);
        });

        test('walking left decreases x', async ({ page }) => {
            const { before, after } = await page.evaluate(() => {
                startGame();
                setChefPos(300, floorY(4));
                const before = chef.x;
                moveChef(-1, 0);
                for (let i = 0; i < 10; i++) step(0.016);
                return { before, after: chef.x };
            });
            expect(after).toBeLessThan(before);
        });

        test('the chef cannot walk off the left edge', async ({ page }) => {
            const x = await page.evaluate(() => {
                startGame();
                setChefPos(40, floorY(4));
                moveChef(-1, 0);
                for (let i = 0; i < 200; i++) step(0.016);
                return chef.x;
            });
            expect(x).toBeGreaterThanOrEqual(0);
        });

        test('the chef cannot walk off the right edge', async ({ page }) => {
            const x = await page.evaluate(() => {
                startGame();
                setChefPos(600, floorY(4));
                moveChef(1, 0);
                for (let i = 0; i < 200; i++) step(0.016);
                return chef.x;
            });
            expect(x).toBeLessThanOrEqual(640);
        });

        test('the chef cannot climb away from a ladder', async ({ page }) => {
            const { before, after } = await page.evaluate(() => {
                startGame();
                const x = (LADDER_XS[0] + LADDER_XS[1]) / 2;
                setChefPos(x, floorY(3));
                const before = chef.y;
                moveChef(0, -1);
                for (let i = 0; i < 20; i++) step(0.016);
                return { before, after: chef.y };
            });
            expect(after).toBe(before);
        });

        test('climbing up a ladder decreases y', async ({ page }) => {
            const { before, after } = await page.evaluate(() => {
                startGame();
                setChefPos(LADDER_XS[1], floorY(3));
                const before = chef.y;
                moveChef(0, -1);
                for (let i = 0; i < 20; i++) step(0.016);
                return { before, after: chef.y };
            });
            expect(after).toBeLessThan(before);
        });

        test('climbing down a ladder increases y', async ({ page }) => {
            const { before, after } = await page.evaluate(() => {
                startGame();
                setChefPos(LADDER_XS[1], floorY(2));
                const before = chef.y;
                moveChef(0, 1);
                for (let i = 0; i < 20; i++) step(0.016);
                return { before, after: chef.y };
            });
            expect(after).toBeGreaterThan(before);
        });

        test('the chef cannot climb above the top floor', async ({ page }) => {
            const { y, top } = await page.evaluate(() => {
                startGame();
                setChefPos(LADDER_XS[1], floorY(0));
                moveChef(0, -1);
                for (let i = 0; i < 200; i++) step(0.016);
                return { y: chef.y, top: floorY(0) };
            });
            expect(y).toBe(top);
        });

        test('the chef cannot climb below the bottom floor', async ({ page }) => {
            const { y, bottom } = await page.evaluate(() => {
                startGame();
                setChefPos(LADDER_XS[1], floorY(FLOOR_COUNT - 1));
                moveChef(0, 1);
                for (let i = 0; i < 200; i++) step(0.016);
                return { y: chef.y, bottom: floorY(FLOOR_COUNT - 1) };
            });
            expect(y).toBe(bottom);
        });

        test('climbing a full floor lands the chef on the floor above', async ({ page }) => {
            const { y, target } = await page.evaluate(() => {
                startGame();
                setChefPos(LADDER_XS[1], floorY(3));
                moveChef(0, -1);
                for (let i = 0; i < 200; i++) step(0.016);
                return { y: chef.y, target: floorY(0) };
            });
            expect(y).toBe(target);
        });

        test('ArrowRight moves the chef right', async ({ page }) => {
            await page.evaluate(() => { startGame(); setChefPos(300, floorY(4)); });
            const before = await page.evaluate(() => chef.x);
            await page.keyboard.down('ArrowRight');
            await page.evaluate(() => { for (let i = 0; i < 10; i++) step(0.016); });
            await page.keyboard.up('ArrowRight');
            const after = await page.evaluate(() => chef.x);
            expect(after).toBeGreaterThan(before);
        });
    });

    // -----------------------------------------------------------------------
    // Ingredients: stepping, falling, pushing, plating
    // -----------------------------------------------------------------------
    test.describe('ingredients', () => {
        test('walking over a segment presses it down', async ({ page }) => {
            const segs = await page.evaluate(() => {
                startGame();
                const ing = ingredients.find((i) => i.floor === 2);
                setChefPos(ing.x + SEG_W / 2, floorY(ing.floor));
                step(0.016);
                return ing.segs.slice();
            });
            expect(segs[0]).toBe(true);
            expect(segs[1]).toBe(false);
        });

        test('a segment away from the chef stays up', async ({ page }) => {
            const segs = await page.evaluate(() => {
                startGame();
                const ing = ingredients.find((i) => i.floor === 2);
                setChefPos(ing.x - 40, floorY(ing.floor));
                step(0.016);
                return ing.segs.slice();
            });
            expect(segs.some(Boolean)).toBe(false);
        });

        test('the chef on a different floor does not press segments', async ({ page }) => {
            const pressed = await page.evaluate(() => {
                startGame();
                const ing = ingredients.find((i) => i.floor === 2);
                setChefPos(ing.x + SEG_W / 2, floorY(4));
                step(0.016);
                return ing.segs.some(Boolean);
            });
            expect(pressed).toBe(false);
        });

        test('pressing every segment drops the ingredient', async ({ page }) => {
            const falling = await page.evaluate(() => {
                startGame();
                const ing = ingredients.find((i) => i.floor === 2);
                for (let s = 0; s < SEG_COUNT; s++) {
                    setChefPos(ing.x + s * SEG_W + SEG_W / 2, floorY(ing.floor));
                    step(0.016);
                }
                return ing.falling;
            });
            expect(falling).toBe(true);
        });

        test('a falling ingredient moves downward', async ({ page }) => {
            const { before, after } = await page.evaluate(() => {
                startGame();
                const ing = ingredients.find((i) => i.floor === 2);
                forceDrop(ing);
                const before = ing.y;
                for (let i = 0; i < 5; i++) step(0.016);
                return { before, after: ing.y };
            });
            expect(after).toBeGreaterThan(before);
        });

        test('an ingredient lands on the next empty floor down', async ({ page }) => {
            const ing = await page.evaluate(() => {
                startGame();
                const target = ingredients.find((i) => i.floor === 2);
                forceDrop(target);
                for (let i = 0; i < 120; i++) step(0.016);
                return { floor: target.floor, falling: target.falling, segs: target.segs.slice() };
            });
            expect(ing.floor).toBe(3);
            expect(ing.falling).toBe(false);
            expect(ing.segs.some(Boolean)).toBe(false);
        });

        test('landing on a resting ingredient pushes both a floor further', async ({ page }) => {
            const result = await page.evaluate(() => {
                startGame();
                const col = 0;
                const upper = ingredients.find((i) => i.col === col && i.floor === 1);
                const lower = ingredients.find((i) => i.col === col && i.floor === 2);
                forceDrop(upper);
                for (let i = 0; i < 200; i++) step(0.016);
                return {
                    upper: { floor: upper.floor, stack: upper.stack },
                    lower: { floor: lower.floor, stack: lower.stack },
                };
            });
            // Both end up on floor 3, the pushed ingredient underneath.
            expect(result.lower.floor).toBe(3);
            expect(result.upper.floor).toBe(3);
            expect(result.lower.stack).toBe(0);
            expect(result.upper.stack).toBe(1);
        });

        test('an ingredient dropped off the bottom floor lands on the plate', async ({ page }) => {
            const floor = await page.evaluate(() => {
                startGame();
                const ing = ingredients.find((i) => i.col === 0 && i.floor === 2);
                for (let drop = 0; drop < 3; drop++) {
                    forceDrop(ing);
                    for (let i = 0; i < 200; i++) step(0.016);
                }
                return ing.floor;
            });
            expect(floor).toBe(5);
        });

        test('dropping an ingredient scores points', async ({ page }) => {
            const { before, after } = await page.evaluate(() => {
                startGame();
                const before = score;
                const ing = ingredients.find((i) => i.floor === 2);
                forceDrop(ing);
                for (let i = 0; i < 120; i++) step(0.016);
                return { before, after: score };
            });
            expect(after).toBeGreaterThan(before);
        });

        test('a plated ingredient stays put', async ({ page }) => {
            const stayed = await page.evaluate(() => {
                startGame();
                const ing = ingredients.find((i) => i.col === 0 && i.floor === 2);
                for (let drop = 0; drop < 3; drop++) {
                    forceDrop(ing);
                    for (let i = 0; i < 200; i++) step(0.016);
                }
                const y = ing.y;
                for (let i = 0; i < 100; i++) step(0.016);
                return ing.y === y && ing.floor === PLATE_FLOOR;
            });
            expect(stayed).toBe(true);
        });
    });

    // -----------------------------------------------------------------------
    // Enemies
    // -----------------------------------------------------------------------
    test.describe('enemies', () => {
        test('an enemy on the same floor walks toward the chef', async ({ page }) => {
            const { before, after } = await page.evaluate(() => {
                startGame();
                enemies.length = 0;
                setChefPos(60, floorY(4));
                const e = spawnEnemy({ x: 600, y: floorY(4) });
                const before = e.x;
                for (let i = 0; i < 30; i++) step(0.016);
                return { before, after: e.x };
            });
            expect(after).toBeLessThan(before);
        });

        test('an enemy climbs toward the chef on another floor', async ({ page }) => {
            const climbed = await page.evaluate(() => {
                startGame();
                enemies.length = 0;
                setChefPos(LADDER_XS[0], floorY(0));
                const e = spawnEnemy({ x: 300, y: floorY(4) });
                const start = e.y;
                for (let i = 0; i < 600; i++) {
                    step(0.016);
                    if (e.y < start - 1) return true;
                }
                return false;
            });
            expect(climbed).toBe(true);
        });

        test('touching an enemy costs a life', async ({ page }) => {
            const lives = await page.evaluate(() => {
                startGame();
                enemies.length = 0;
                setChefPos(300, floorY(4));
                spawnEnemy({ x: 302, y: floorY(4) });
                step(0.016);
                return lives;
            });
            expect(lives).toBe(2);
        });

        test('losing a life returns the chef to the start position', async ({ page }) => {
            const ok = await page.evaluate(() => {
                startGame();
                const startX = chef.x;
                enemies.length = 0;
                setChefPos(300, floorY(4));
                spawnEnemy({ x: 302, y: floorY(4) });
                step(0.016);
                return chef.x === startX && chef.y === floorY(FLOOR_COUNT - 1);
            });
            expect(ok).toBe(true);
        });

        test('a stunned enemy does not cost a life', async ({ page }) => {
            const lives = await page.evaluate(() => {
                startGame();
                enemies.length = 0;
                setChefPos(300, floorY(4));
                spawnEnemy({ x: 302, y: floorY(4), stunned: 5 });
                step(0.016);
                return lives;
            });
            expect(lives).toBe(3);
        });

        test('losing the last life ends the game', async ({ page }) => {
            const s = await page.evaluate(() => {
                startGame();
                lives = 1;
                enemies.length = 0;
                setChefPos(300, floorY(4));
                spawnEnemy({ x: 302, y: floorY(4) });
                step(0.016);
                return state;
            });
            expect(s).toBe('over');
        });

        test('a falling ingredient squashes an enemy', async ({ page }) => {
            const result = await page.evaluate(() => {
                startGame();
                enemies.length = 0;
                setChefPos(600, floorY(4));
                const ing = ingredients.find((i) => i.floor === 2);
                spawnEnemy({ x: ing.x + ING_W / 2, y: floorY(3), stunned: 99 });
                const before = score;
                forceDrop(ing);
                for (let i = 0; i < 120; i++) step(0.016);
                return { enemies: enemies.length, gained: score - before };
            });
            expect(result.enemies).toBe(0);
            expect(result.gained).toBeGreaterThan(200);
        });

        test('enemies respawn over time', async ({ page }) => {
            const n = await page.evaluate(() => {
                startGame();
                enemies.length = 0;
                setChefPos(320, floorY(0));
                for (let i = 0; i < 600; i++) step(0.016);
                return enemies.length;
            });
            expect(n).toBeGreaterThan(0);
        });

        test('later levels field more enemies', async ({ page }) => {
            const { early, late } = await page.evaluate(() => ({
                early: maxEnemies(1),
                late: maxEnemies(5),
            }));
            expect(late).toBeGreaterThan(early);
        });
    });

    // -----------------------------------------------------------------------
    // Pepper
    // -----------------------------------------------------------------------
    test.describe('pepper', () => {
        test('spraying uses a pepper', async ({ page }) => {
            const p = await page.evaluate(() => {
                startGame();
                sprayPepper();
                return pepper;
            });
            expect(p).toBe(4);
        });

        test('pepper stuns an enemy in front of the chef', async ({ page }) => {
            const stunned = await page.evaluate(() => {
                startGame();
                enemies.length = 0;
                setChefPos(300, floorY(4));
                moveChef(1, 0);
                step(0.016);
                const e = spawnEnemy({ x: chef.x + 30, y: floorY(4) });
                sprayPepper();
                return e.stunned;
            });
            expect(stunned).toBeGreaterThan(0);
        });

        test('pepper does not reach an enemy behind the chef', async ({ page }) => {
            const stunned = await page.evaluate(() => {
                startGame();
                enemies.length = 0;
                setChefPos(300, floorY(4));
                moveChef(1, 0);
                step(0.016);
                const e = spawnEnemy({ x: chef.x - 90, y: floorY(4) });
                sprayPepper();
                return e.stunned;
            });
            expect(stunned).toBe(0);
        });

        test('a stunned enemy stands still', async ({ page }) => {
            const { before, after } = await page.evaluate(() => {
                startGame();
                enemies.length = 0;
                setChefPos(60, floorY(4));
                const e = spawnEnemy({ x: 600, y: floorY(4), stunned: 5 });
                const before = e.x;
                for (let i = 0; i < 30; i++) step(0.016);
                return { before, after: e.x };
            });
            expect(after).toBe(before);
        });

        test('a stun wears off', async ({ page }) => {
            const stunned = await page.evaluate(() => {
                startGame();
                enemies.length = 0;
                setChefPos(320, floorY(0));
                const e = spawnEnemy({ x: 600, y: floorY(4), stunned: 0.2 });
                for (let i = 0; i < 30; i++) step(0.016);
                return e.stunned;
            });
            expect(stunned).toBeLessThanOrEqual(0);
        });

        test('spraying with no pepper left does nothing', async ({ page }) => {
            const result = await page.evaluate(() => {
                startGame();
                pepper = 0;
                const sprayed = sprayPepper();
                return { sprayed, pepper };
            });
            expect(result.sprayed).toBe(false);
            expect(result.pepper).toBe(0);
        });

        test('the pepper count is shown in the HUD', async ({ page }) => {
            await page.evaluate(() => { startGame(); sprayPepper(); updateHud(); });
            await expect(page.locator('#pepper')).toHaveText('4');
        });
    });

    // -----------------------------------------------------------------------
    // Levels
    // -----------------------------------------------------------------------
    test.describe('levels', () => {
        test('plating every ingredient advances the level', async ({ page }) => {
            const result = await page.evaluate(() => {
                const before = score;
                startGame();
                for (let guard = 0; guard < 300 && level === 1; guard++) {
                    enemies.length = 0;
                    const ing = ingredients.find((i) => i.floor < PLATE_FLOOR && !i.falling);
                    if (ing) forceDrop(ing);
                    for (let i = 0; i < 60; i++) step(0.016);
                }
                return { level, score, before };
            });
            expect(result.level).toBe(2);
            expect(result.score).toBeGreaterThan(1000);
        });

        test('a new level restocks the ingredients and refills pepper', async ({ page }) => {
            const result = await page.evaluate(() => {
                startGame();
                pepper = 0;
                for (let guard = 0; guard < 300 && level === 1; guard++) {
                    enemies.length = 0;
                    const ing = ingredients.find((i) => i.floor < PLATE_FLOOR && !i.falling);
                    if (ing) forceDrop(ing);
                    for (let i = 0; i < 60; i++) step(0.016);
                }
                return {
                    ingredients: ingredients.length,
                    plated: ingredients.filter((i) => i.floor === PLATE_FLOOR).length,
                    pepper,
                };
            });
            expect(result.ingredients).toBe(9);
            expect(result.plated).toBe(0);
            expect(result.pepper).toBeGreaterThan(0);
        });

        test('enemies get faster on later levels', async ({ page }) => {
            const { slow, fast } = await page.evaluate(() => ({
                slow: enemySpeed(1),
                fast: enemySpeed(4),
            }));
            expect(fast).toBeGreaterThan(slow);
        });
    });

    // -----------------------------------------------------------------------
    // Scoring & best
    // -----------------------------------------------------------------------
    test.describe('scoring', () => {
        test('best score updates on game over when beaten', async ({ page }) => {
            await page.evaluate(() => {
                startGame();
                score = 5150;
                updateHud();
                endGame();
            });
            await expect(page.locator('#best')).toHaveText('5150');
        });

        test('best score persists to localStorage', async ({ page }) => {
            await page.evaluate(() => {
                startGame();
                score = 2400;
                updateHud();
                endGame();
            });
            const stored = await page.evaluate(() => window.localStorage.getItem('burgertime-best'));
            expect(parseInt(stored, 10)).toBe(2400);
        });

        test('best score is not lowered by a worse run', async ({ page }) => {
            await page.evaluate(() => window.localStorage.setItem('burgertime-best', '9000'));
            await page.reload();
            await page.evaluate(() => {
                startGame();
                score = 10;
                updateHud();
                endGame();
            });
            await expect(page.locator('#best')).toHaveText('9000');
        });

        test('game over shows the overlay with Play Again', async ({ page }) => {
            await page.evaluate(() => { startGame(); endGame(); });
            await expect(page.locator('#overlay')).toHaveClass(/visible/);
            await expect(page.locator('#btn-start')).toHaveText('Play Again');
        });
    });

    // -----------------------------------------------------------------------
    // Pause & restart
    // -----------------------------------------------------------------------
    test.describe('pause and restart', () => {
        test('pausing freezes a falling ingredient', async ({ page }) => {
            const { before, after } = await page.evaluate(() => {
                startGame();
                const ing = ingredients.find((i) => i.floor === 2);
                forceDrop(ing);
                togglePause();
                const before = ing.y;
                for (let i = 0; i < 20; i++) step(0.016);
                return { before, after: ing.y };
            });
            expect(after).toBe(before);
        });

        test('resuming lets it fall again', async ({ page }) => {
            const moved = await page.evaluate(() => {
                startGame();
                const ing = ingredients.find((i) => i.floor === 2);
                forceDrop(ing);
                togglePause();
                togglePause();
                const before = ing.y;
                for (let i = 0; i < 5; i++) step(0.016);
                return ing.y > before;
            });
            expect(moved).toBe(true);
        });

        test('pausing freezes the enemies', async ({ page }) => {
            const same = await page.evaluate(() => {
                startGame();
                enemies.length = 0;
                setChefPos(60, floorY(4));
                const e = spawnEnemy({ x: 600, y: floorY(4) });
                togglePause();
                const before = e.x;
                for (let i = 0; i < 20; i++) step(0.016);
                return e.x === before;
            });
            expect(same).toBe(true);
        });

        test('restart after game over resets score, level, lives and the board', async ({ page }) => {
            const result = await page.evaluate(() => {
                startGame();
                score = 4321;
                level = 6;
                lives = 1;
                pepper = 0;
                endGame();
                startGame();
                return {
                    score, level, lives, pepper, state,
                    ingredients: ingredients.length,
                    plated: ingredients.filter((i) => i.floor === PLATE_FLOOR).length,
                };
            });
            expect(result).toEqual({
                score: 0,
                level: 1,
                lives: 3,
                pepper: 5,
                state: 'running',
                ingredients: 9,
                plated: 0,
            });
        });
    });
});
