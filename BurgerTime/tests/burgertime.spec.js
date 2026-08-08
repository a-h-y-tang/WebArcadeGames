const { test, expect } = require('@playwright/test');
const path = require('path');
const { pathToFileURL } = require('url');

const GAME_URL = pathToFileURL(path.resolve(__dirname, '../index.html')).href;

// Run `n` simulation frames of a fixed length. Used everywhere so that tests
// never depend on requestAnimationFrame wall-clock timing.
const FRAME = 0.016;

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

        test('start overlay is visible and prompts the player', async ({ page }) => {
            await expect(page.locator('#overlay')).toHaveClass(/visible/);
            await expect(page.locator('#overlay-sub')).toContainText(/enter|start/i);
        });

        test('HUD starts at zero score, level 1, three lives', async ({ page }) => {
            await expect(page.locator('#score')).toHaveText('0');
            await expect(page.locator('#best')).toHaveText('0');
            await expect(page.locator('#level')).toHaveText('1');
            await expect(page.locator('#lives')).toHaveText('3');
        });

        test('canvas is 600x480', async ({ page }) => {
            const canvas = page.locator('#canvas');
            await expect(canvas).toHaveAttribute('width', '600');
            await expect(canvas).toHaveAttribute('height', '480');
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
    // Board geometry
    // -----------------------------------------------------------------------
    test.describe('board', () => {
        test('there are five girder levels, top to bottom', async ({ page }) => {
            const ys = await page.evaluate(() => LEVEL_Y.slice());
            expect(ys).toHaveLength(5);
            for (let i = 1; i < ys.length; i++) expect(ys[i]).toBeGreaterThan(ys[i - 1]);
        });

        test('the plates sit below the bottom girder', async ({ page }) => {
            const { plateY, bottom } = await page.evaluate(() => ({
                plateY: PLATE_Y,
                bottom: LEVEL_Y[PLATE_LEVEL],
            }));
            expect(plateY).toBeGreaterThan(bottom);
        });

        test('the bottom level is the plate level', async ({ page }) => {
            const { plate, count } = await page.evaluate(() => ({ plate: PLATE_LEVEL, count: LEVEL_Y.length }));
            expect(plate).toBe(count - 1);
        });

        test('ladders sit in the gaps between the burger stacks', async ({ page }) => {
            const clash = await page.evaluate(() => {
                const bad = [];
                for (const col of LADDER_COLS) {
                    for (let s = 0; s < STACK_COUNT; s++) {
                        const start = stackStartCol(s);
                        if (col >= start && col < start + STACK_TILES) bad.push(col);
                    }
                }
                return bad;
            });
            expect(clash).toEqual([]);
        });

        test('the board holds four stacks of four ingredients', async ({ page }) => {
            const info = await page.evaluate(() => ({
                total: ingredients.length,
                stacks: STACK_COUNT,
                perStack: INGREDIENTS_PER_STACK,
            }));
            expect(info.stacks).toBe(4);
            expect(info.perStack).toBe(4);
            expect(info.total).toBe(16);
        });

        test('each stack starts with one ingredient on each of the top four levels', async ({ page }) => {
            const levels = await page.evaluate(() =>
                [0, 1, 2, 3].map((s) => ingredients.filter((i) => i.stack === s).map((i) => i.level).sort())
            );
            for (const stack of levels) expect(stack).toEqual([0, 1, 2, 3]);
        });

        test('every ingredient starts at rest with no tiles stepped', async ({ page }) => {
            const clean = await page.evaluate(() =>
                ingredients.every((i) => i.state === 'rest' && i.stepped.every((t) => t === false))
            );
            expect(clean).toBe(true);
        });
    });

    // -----------------------------------------------------------------------
    // Starting the game
    // -----------------------------------------------------------------------
    test.describe('starting', () => {
        test('Enter starts the game and hides the overlay', async ({ page }) => {
            await page.keyboard.press('Enter');
            expect(await page.evaluate(() => state)).toBe('running');
            await expect(page.locator('#overlay')).not.toHaveClass(/visible/);
        });

        test('the Start button starts the game', async ({ page }) => {
            await page.locator('#btn-start').click();
            expect(await page.evaluate(() => state)).toBe('running');
        });

        test('a new game resets score, level, lives and peppers', async ({ page }) => {
            const s = await page.evaluate(() => {
                startGame();
                return { score, level, lives, peppers, start: START_PEPPERS };
            });
            expect(s.score).toBe(0);
            expect(s.level).toBe(1);
            expect(s.lives).toBe(3);
            expect(s.peppers).toBe(s.start);
        });

        test('the chef starts standing on the bottom girder', async ({ page }) => {
            const chefY = await page.evaluate(() => { startGame(); return chef.y; });
            const bottom = await page.evaluate(() => LEVEL_Y[LEVEL_Y.length - 1]);
            expect(chefY).toBe(bottom);
        });

        test('enemies are on the board once the game starts', async ({ page }) => {
            const n = await page.evaluate(() => { startGame(); return enemies.length; });
            expect(n).toBeGreaterThan(0);
        });

        test('the simulation does not advance while idle', async ({ page }) => {
            const moved = await page.evaluate(() => {
                const before = chef.x;
                moveChef(1, 0);
                for (let i = 0; i < 30; i++) step(0.016);
                return chef.x !== before;
            });
            expect(moved).toBe(false);
        });
    });

    // -----------------------------------------------------------------------
    // Chef movement
    // -----------------------------------------------------------------------
    test.describe('chef movement', () => {
        test('walking right increases x', async ({ page }) => {
            const { before, after } = await page.evaluate(() => {
                startGame();
                enemies.length = 0;
                placeChef(4, 300);
                const before = chef.x;
                moveChef(1, 0);
                for (let i = 0; i < 20; i++) step(0.016);
                return { before, after: chef.x };
            });
            expect(after).toBeGreaterThan(before);
        });

        test('walking left decreases x', async ({ page }) => {
            const { before, after } = await page.evaluate(() => {
                startGame();
                enemies.length = 0;
                placeChef(4, 300);
                const before = chef.x;
                moveChef(-1, 0);
                for (let i = 0; i < 20; i++) step(0.016);
                return { before, after: chef.x };
            });
            expect(after).toBeLessThan(before);
        });

        test('the chef cannot walk off the left edge', async ({ page }) => {
            const x = await page.evaluate(() => {
                startGame();
                enemies.length = 0;
                placeChef(4, 60);
                moveChef(-1, 0);
                for (let i = 0; i < 400; i++) step(0.016);
                return chef.x;
            });
            expect(x).toBeGreaterThanOrEqual(0);
        });

        test('the chef cannot walk off the right edge', async ({ page }) => {
            const { x, w } = await page.evaluate(() => {
                startGame();
                enemies.length = 0;
                placeChef(4, 540);
                moveChef(1, 0);
                for (let i = 0; i < 400; i++) step(0.016);
                return { x: chef.x, w: CANVAS_W };
            });
            expect(x).toBeLessThanOrEqual(w);
        });

        test('the chef climbs when lined up with a ladder', async ({ page }) => {
            const { before, after } = await page.evaluate(() => {
                startGame();
                enemies.length = 0;
                placeChef(4, ladderX(1));
                const before = chef.y;
                moveChef(0, -1);
                for (let i = 0; i < 20; i++) step(0.016);
                return { before, after: chef.y };
            });
            expect(after).toBeLessThan(before);
        });

        test('the chef cannot climb away from a ladder', async ({ page }) => {
            const { before, after } = await page.evaluate(() => {
                startGame();
                enemies.length = 0;
                placeChef(4, ladderX(1) + 60);
                const before = chef.y;
                moveChef(0, -1);
                for (let i = 0; i < 20; i++) step(0.016);
                return { before, after: chef.y };
            });
            expect(after).toBe(before);
        });

        test('climbing stops at the top girder', async ({ page }) => {
            const y = await page.evaluate(() => {
                startGame();
                enemies.length = 0;
                placeChef(4, ladderX(1));
                moveChef(0, -1);
                for (let i = 0; i < 600; i++) step(0.016);
                return chef.y;
            });
            const top = await page.evaluate(() => LEVEL_Y[0]);
            expect(y).toBe(top);
        });

        test('climbing stops at the bottom girder', async ({ page }) => {
            const y = await page.evaluate(() => {
                startGame();
                enemies.length = 0;
                placeChef(0, ladderX(0));
                moveChef(0, 1);
                for (let i = 0; i < 600; i++) step(0.016);
                return chef.y;
            });
            const bottom = await page.evaluate(() => LEVEL_Y[PLATE_LEVEL]);
            expect(y).toBe(bottom);
        });

        test('the ArrowRight key walks the chef right', async ({ page }) => {
            await page.evaluate(() => { startGame(); enemies.length = 0; placeChef(4, 300); });
            const before = await page.evaluate(() => chef.x);
            await page.keyboard.down('ArrowRight');
            await page.evaluate(() => { for (let i = 0; i < 20; i++) step(0.016); });
            await page.keyboard.up('ArrowRight');
            const after = await page.evaluate(() => chef.x);
            expect(after).toBeGreaterThan(before);
        });
    });

    // -----------------------------------------------------------------------
    // Walking ingredients down
    // -----------------------------------------------------------------------
    test.describe('ingredients', () => {
        test('walking a tile marks it stepped', async ({ page }) => {
            const stepped = await page.evaluate(() => {
                startGame();
                enemies.length = 0;
                placeChef(0, 20);
                step(0.016);
                return ingredientAt(0, 0).stepped.slice();
            });
            expect(stepped[0]).toBe(true);
            expect(stepped[1]).toBe(false);
        });

        test('a partial walk does not drop the ingredient', async ({ page }) => {
            const state = await page.evaluate(() => {
                startGame();
                enemies.length = 0;
                placeChef(0, 5);
                moveChef(1, 0);
                // enough frames to cross the first tile only
                for (let i = 0; i < 20; i++) step(0.016);
                const ing = ingredients.find((i) => i.stack === 0 && i.level === 0);
                return { state: ing.state, stepped: ing.stepped.filter(Boolean).length };
            });
            expect(state.state).toBe('rest');
            expect(state.stepped).toBeLessThan(3);
        });

        test('walking the full width of an ingredient drops it', async ({ page }) => {
            const st = await page.evaluate(() => {
                startGame();
                enemies.length = 0;
                const ing = ingredientAt(0, 0);
                placeChef(0, 5);
                moveChef(1, 0);
                for (let i = 0; i < 100 && ing.state === 'rest'; i++) step(0.016);
                return ing.state;
            });
            expect(st).toBe('falling');
        });

        test('dropping an ingredient scores points', async ({ page }) => {
            const s = await page.evaluate(() => {
                startGame();
                enemies.length = 0;
                score = 0;
                dropIngredient(ingredientAt(0, 3));
                return score;
            });
            expect(s).toBeGreaterThan(0);
        });

        test('a dropped ingredient falls downward', async ({ page }) => {
            const { before, after } = await page.evaluate(() => {
                startGame();
                enemies.length = 0;
                const ing = ingredientAt(0, 0);
                dropIngredient(ing);
                const before = ing.y;
                for (let i = 0; i < 5; i++) step(0.016);
                return { before, after: ing.y };
            });
            expect(after).toBeGreaterThan(before);
        });

        test('an ingredient landing on another knocks it down one level', async ({ page }) => {
            const levels = await page.evaluate(() => {
                startGame();
                enemies.length = 0;
                const top = ingredientAt(0, 0);
                dropIngredient(top);
                for (let i = 0; i < 600; i++) step(0.016);
                return ingredients
                    .filter((i) => i.stack === 0)
                    .map((i) => ({ kind: i.kind, level: i.level, state: i.state }));
            });
            const byKind = Object.fromEntries(levels.map((l) => [l.kind, l]));
            expect(byKind.bunTop.level).toBe(1);
            expect(byKind.lettuce.level).toBe(2);
            expect(byKind.patty.level).toBe(3);
            expect(byKind.bunHeel.state).toBe('plated');
        });

        test('a dropped ingredient forgets its stepped tiles', async ({ page }) => {
            const stepped = await page.evaluate(() => {
                startGame();
                enemies.length = 0;
                const ing = ingredientAt(0, 0);
                ing.stepped = [true, true, false];
                dropIngredient(ing);
                for (let i = 0; i < 600; i++) step(0.016);
                return ing.stepped.slice();
            });
            expect(stepped).toEqual([false, false, false]);
        });

        test('an ingredient reaching the bottom is plated and settles on the plate', async ({ page }) => {
            const res = await page.evaluate(() => {
                startGame();
                enemies.length = 0;
                const heel = ingredientAt(0, 3);
                dropIngredient(heel);
                for (let i = 0; i < 600; i++) step(0.016);
                return { state: heel.state, y: heel.y, plateTop: PLATE_Y - ING_H };
            });
            expect(res.state).toBe('plated');
            expect(res.y).toBeCloseTo(res.plateTop, 3);
        });

        test('plated ingredients stack on top of each other', async ({ page }) => {
            const res = await page.evaluate(() => {
                startGame();
                enemies.length = 0;
                const heel = ingredientAt(0, 3);
                dropIngredient(heel);
                for (let i = 0; i < 600; i++) step(0.016);
                // the patty needs two drops of its own: level 2 -> 3, then 3 -> plate
                const patty = ingredientAt(0, 2);
                dropIngredient(patty);
                for (let i = 0; i < 600; i++) step(0.016);
                dropIngredient(patty);
                for (let i = 0; i < 600; i++) step(0.016);
                return { heelY: heel.y, pattyY: patty.y, h: ING_H, state: patty.state };
            });
            expect(res.state).toBe('plated');
            expect(res.pattyY).toBeCloseTo(res.heelY - res.h, 3);
        });

        test('plated ingredients cannot be stepped on again', async ({ page }) => {
            const stepped = await page.evaluate(() => {
                startGame();
                enemies.length = 0;
                const heel = ingredientAt(0, 3);
                dropIngredient(heel);
                for (let i = 0; i < 600; i++) step(0.016);
                placeChef(PLATE_LEVEL, 20);
                moveChef(1, 0);
                for (let i = 0; i < 200; i++) step(0.016);
                return heel.stepped.filter(Boolean).length;
            });
            expect(stepped).toBe(0);
        });
    });

    // -----------------------------------------------------------------------
    // Levels
    // -----------------------------------------------------------------------
    test.describe('levels', () => {
        test('plating every ingredient advances to the next level', async ({ page }) => {
            const res = await page.evaluate(() => {
                startGame();
                enemies.length = 0;
                ingredients.forEach((i) => { i.state = 'plated'; });
                step(0.016);
                return { level, resting: ingredients.filter((i) => i.state === 'rest').length };
            });
            expect(res.level).toBe(2);
            expect(res.resting).toBe(16);
        });

        test('clearing a level awards a bonus', async ({ page }) => {
            const s = await page.evaluate(() => {
                startGame();
                enemies.length = 0;
                score = 0;
                ingredients.forEach((i) => { i.state = 'plated'; });
                step(0.016);
                return score;
            });
            expect(s).toBeGreaterThanOrEqual(1000);
        });

        test('later levels have faster enemies', async ({ page }) => {
            const { l1, l3 } = await page.evaluate(() => {
                startGame();
                const l1 = enemySpeed();
                level = 3;
                const l3 = enemySpeed();
                return { l1, l3 };
            });
            expect(l3).toBeGreaterThan(l1);
        });
    });

    // -----------------------------------------------------------------------
    // Enemies
    // -----------------------------------------------------------------------
    test.describe('enemies', () => {
        test('an enemy on the same girder walks toward the chef', async ({ page }) => {
            const { before, after } = await page.evaluate(() => {
                startGame();
                enemies.length = 0;
                placeChef(0, 500);
                spawnEnemy(0, 100);
                const before = enemies[0].x;
                for (let i = 0; i < 30; i++) step(0.016);
                return { before, after: enemies[0].x };
            });
            expect(after).toBeGreaterThan(before);
        });

        test('an enemy on another girder heads for a ladder', async ({ page }) => {
            const climbed = await page.evaluate(() => {
                startGame();
                enemies.length = 0;
                placeChef(4, 300);
                spawnEnemy(0, 40);
                const y0 = enemies[0].y;
                for (let i = 0; i < 400; i++) step(0.016);
                return enemies[0].y > y0;
            });
            expect(climbed).toBe(true);
        });

        test('touching an enemy costs a life', async ({ page }) => {
            const lives = await page.evaluate(() => {
                startGame();
                enemies.length = 0;
                placeChef(2, 300);
                spawnEnemy(2, 300);
                step(0.016);
                return lives;
            });
            expect(lives).toBe(2);
        });

        test('losing a life resets the chef to the spawn point', async ({ page }) => {
            const same = await page.evaluate(() => {
                startGame();
                const spawnX = chef.x, spawnY = chef.y;
                enemies.length = 0;
                placeChef(2, 300);
                spawnEnemy(2, 300);
                step(0.016);
                return chef.x === spawnX && chef.y === spawnY;
            });
            expect(same).toBe(true);
        });

        test('losing the last life ends the game', async ({ page }) => {
            const st = await page.evaluate(() => {
                startGame();
                lives = 1;
                enemies.length = 0;
                placeChef(2, 300);
                spawnEnemy(2, 300);
                step(0.016);
                return state;
            });
            expect(st).toBe('over');
        });

        test('a stunned enemy does not move and is harmless', async ({ page }) => {
            const res = await page.evaluate(() => {
                startGame();
                enemies.length = 0;
                placeChef(2, 300);
                const e = spawnEnemy(2, 300);
                e.stun = 5;
                const x0 = e.x;
                for (let i = 0; i < 30; i++) step(0.016);
                return { moved: e.x !== x0, lives };
            });
            expect(res.moved).toBe(false);
            expect(res.lives).toBe(3);
        });

        test('a falling ingredient squashes an enemy', async ({ page }) => {
            const res = await page.evaluate(() => {
                startGame();
                enemies.length = 0;
                placeChef(PLATE_LEVEL, 560);
                score = 0;
                const heel = ingredientAt(0, 3);
                const e = spawnEnemy(PLATE_LEVEL, 60);
                dropIngredient(heel);
                for (let i = 0; i < 120; i++) step(0.016);
                return { alive: e.alive, score };
            });
            expect(res.alive).toBe(false);
            expect(res.score).toBeGreaterThan(50);
        });

        test('a squashed enemy respawns after a delay', async ({ page }) => {
            const alive = await page.evaluate(() => {
                startGame();
                enemies.length = 0;
                placeChef(PLATE_LEVEL, 560);
                const heel = ingredientAt(0, 3);
                const e = spawnEnemy(PLATE_LEVEL, 60);
                dropIngredient(heel);
                for (let i = 0; i < 120; i++) step(0.016);
                const squashed = e.alive;
                for (let i = 0; i < 300; i++) step(0.016);
                return { squashed, now: e.alive };
            });
            expect(alive.squashed).toBe(false);
            expect(alive.now).toBe(true);
        });
    });

    // -----------------------------------------------------------------------
    // Pepper
    // -----------------------------------------------------------------------
    test.describe('pepper', () => {
        test('spraying stuns an enemy in front of the chef', async ({ page }) => {
            const stun = await page.evaluate(() => {
                startGame();
                enemies.length = 0;
                placeChef(2, 300);
                moveChef(1, 0);
                step(0.016);
                const e = spawnEnemy(2, 330);
                sprayPepper();
                return e.stun;
            });
            expect(stun).toBeGreaterThan(0);
        });

        test('spraying uses up a pepper', async ({ page }) => {
            const p = await page.evaluate(() => {
                startGame();
                const before = peppers;
                sprayPepper();
                return { before, after: peppers };
            });
            expect(p.after).toBe(p.before - 1);
        });

        test('spraying with no peppers left does nothing', async ({ page }) => {
            const res = await page.evaluate(() => {
                startGame();
                enemies.length = 0;
                peppers = 0;
                placeChef(2, 300);
                moveChef(1, 0);
                step(0.016);
                const e = spawnEnemy(2, 330);
                sprayPepper();
                return { peppers, stun: e.stun };
            });
            expect(res.peppers).toBe(0);
            expect(res.stun).toBe(0);
        });

        test('an enemy far from the cloud is not stunned', async ({ page }) => {
            const stun = await page.evaluate(() => {
                startGame();
                enemies.length = 0;
                placeChef(2, 100);
                moveChef(1, 0);
                step(0.016);
                const e = spawnEnemy(2, 500);
                sprayPepper();
                return e.stun;
            });
            expect(stun).toBe(0);
        });

        test('a stun wears off over time', async ({ page }) => {
            const stun = await page.evaluate(() => {
                startGame();
                enemies.length = 0;
                placeChef(0, 20);
                const e = spawnEnemy(2, 300);
                e.stun = 0.1;
                for (let i = 0; i < 20; i++) step(0.016);
                return e.stun;
            });
            expect(stun).toBe(0);
        });

        test('the Space key throws pepper', async ({ page }) => {
            await page.evaluate(() => { startGame(); });
            const before = await page.evaluate(() => peppers);
            await page.keyboard.press('Space');
            const after = await page.evaluate(() => peppers);
            expect(after).toBe(before - 1);
        });
    });

    // -----------------------------------------------------------------------
    // Scoring & best
    // -----------------------------------------------------------------------
    test.describe('scoring', () => {
        test('best score updates on game over', async ({ page }) => {
            await page.evaluate(() => {
                startGame();
                score = 7350;
                endGame();
            });
            await expect(page.locator('#best')).toHaveText('7350');
        });

        test('best score persists to localStorage', async ({ page }) => {
            await page.evaluate(() => {
                startGame();
                score = 1234;
                endGame();
            });
            const stored = await page.evaluate(() => window.localStorage.getItem('burgertime-best'));
            expect(parseInt(stored, 10)).toBe(1234);
        });

        test('best score is not lowered by a worse run', async ({ page }) => {
            await page.evaluate(() => window.localStorage.setItem('burgertime-best', '9000'));
            await page.reload();
            await page.evaluate(() => { startGame(); score = 10; endGame(); });
            await expect(page.locator('#best')).toHaveText('9000');
        });

        test('game over shows the overlay with Play Again', async ({ page }) => {
            await page.evaluate(() => { startGame(); endGame(); });
            await expect(page.locator('#overlay')).toHaveClass(/visible/);
            await expect(page.locator('#btn-start')).toHaveText('Play Again');
        });

        test('the HUD tracks the score', async ({ page }) => {
            await page.evaluate(() => {
                startGame();
                enemies.length = 0;
                score = 0;
                dropIngredient(ingredientAt(0, 3));
            });
            await expect(page.locator('#score')).toHaveText('50');
        });
    });

    // -----------------------------------------------------------------------
    // Pause & restart
    // -----------------------------------------------------------------------
    test.describe('pause and restart', () => {
        test('pausing freezes falling ingredients', async ({ page }) => {
            const res = await page.evaluate(() => {
                startGame();
                enemies.length = 0;
                const ing = ingredientAt(0, 0);
                dropIngredient(ing);
                togglePause();
                const before = ing.y;
                for (let i = 0; i < 20; i++) step(0.016);
                return { before, after: ing.y };
            });
            expect(res.after).toBe(res.before);
        });

        test('resuming lets ingredients fall again', async ({ page }) => {
            const moved = await page.evaluate(() => {
                startGame();
                enemies.length = 0;
                const ing = ingredientAt(0, 0);
                dropIngredient(ing);
                togglePause();
                togglePause();
                const before = ing.y;
                for (let i = 0; i < 20; i++) step(0.016);
                return ing.y > before;
            });
            expect(moved).toBe(true);
        });

        test('P toggles pause', async ({ page }) => {
            await page.evaluate(() => startGame());
            await page.keyboard.press('p');
            expect(await page.evaluate(() => state)).toBe('paused');
            await page.keyboard.press('p');
            expect(await page.evaluate(() => state)).toBe('running');
        });

        test('a long scripted run keeps every object in a valid state', async ({ page }) => {
            const res = await page.evaluate(() => {
                startGame();
                let dir = 1;
                for (let i = 0; i < 3000; i++) {
                    if (i % 120 === 0) { dir = -dir; moveChef(dir, 0); }
                    if (i % 300 === 150) moveChef(0, -1);
                    if (i % 300 === 240) moveChef(0, 1);
                    step(0.016);
                }
                const finite = (n) => Number.isFinite(n);
                const onBoard = (o) =>
                    o.x >= 0 && o.x <= CANVAS_W && o.y >= LEVEL_Y[0] && o.y <= LEVEL_Y[PLATE_LEVEL];
                return {
                    state,
                    finite:
                        finite(chef.x) && finite(chef.y) && finite(score) &&
                        enemies.every((e) => finite(e.x) && finite(e.y)) &&
                        ingredients.every((i) => finite(i.y)),
                    states: ingredients.every((i) => ['rest', 'falling', 'plated'].includes(i.state)),
                    chefOnBoard: onBoard(chef),
                    enemiesOnBoard: enemies.every(onBoard),
                    notBelowPlate: ingredients.every((i) => i.y <= PLATE_Y),
                };
            });
            expect(res.finite).toBe(true);
            expect(res.states).toBe(true);
            expect(res.chefOnBoard).toBe(true);
            expect(res.enemiesOnBoard).toBe(true);
            expect(res.notBelowPlate).toBe(true);
            expect(['running', 'over']).toContain(res.state);
        });

        test('restarting after game over rebuilds the board', async ({ page }) => {
            const res = await page.evaluate(() => {
                startGame();
                score = 5000;
                level = 4;
                lives = 1;
                dropIngredient(ingredientAt(0, 0));
                endGame();
                startGame();
                return {
                    score, level, lives, state,
                    resting: ingredients.filter((i) => i.state === 'rest').length,
                };
            });
            expect(res.score).toBe(0);
            expect(res.level).toBe(1);
            expect(res.lives).toBe(3);
            expect(res.state).toBe('running');
            expect(res.resting).toBe(16);
        });
    });
});
