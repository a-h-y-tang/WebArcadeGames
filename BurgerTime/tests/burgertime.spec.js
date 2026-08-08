const { test, expect } = require('@playwright/test');
const path = require('path');
const { pathToFileURL } = require('url');

const GAME_URL = pathToFileURL(path.resolve(__dirname, '../index.html')).href;

/** Start a game and put the chef somewhere known and enemy-free. */
async function startAndPark(page) {
    await page.keyboard.press('Space');
    await page.evaluate(() => {
        enemies.length = 0;          // tests opt in to enemies explicitly
        chef.x = 272;
        chef.floor = 4;
        chef.y = FLOOR_Y[4];
        chef.climbing = false;
    });
}

test.describe('BurgerTime', () => {
    test.beforeEach(async ({ page }) => {
        await page.goto(GAME_URL);
    });

    // -----------------------------------------------------------------------
    // Initial state
    // -----------------------------------------------------------------------
    test.describe('initial state', () => {
        test('page title is BurgerTime', async ({ page }) => {
            await expect(page).toHaveTitle('BurgerTime');
        });

        test('start overlay is visible', async ({ page }) => {
            await expect(page.locator('#overlay')).toHaveClass(/visible/);
        });

        test('canvas is 560x560', async ({ page }) => {
            await expect(page.locator('#canvas')).toHaveAttribute('width', '560');
            await expect(page.locator('#canvas')).toHaveAttribute('height', '560');
        });

        test('HUD starts at zero score, level 1, three lives, five peppers', async ({ page }) => {
            await expect(page.locator('#score')).toHaveText('0');
            await expect(page.locator('#level')).toHaveText('1');
            await expect(page.locator('#lives')).toHaveText('3');
            await expect(page.locator('#pepper')).toHaveText('5');
        });

        test('best score starts at 0 when localStorage is empty', async ({ page }) => {
            await expect(page.locator('#best')).toHaveText('0');
        });

        test('state is idle before starting', async ({ page }) => {
            expect(await page.evaluate(() => state)).toBe('idle');
        });

        test('there are five floors and five ladders', async ({ page }) => {
            expect(await page.evaluate(() => FLOOR_Y.length)).toBe(5);
            expect(await page.evaluate(() => LADDER_X.length)).toBe(5);
        });

        test('no ladder runs through a burger column', async ({ page }) => {
            const clear = await page.evaluate(() =>
                LADDER_X.every(lx => COL_X.every(cx => Math.abs(lx - cx) > BURGER_W / 2))
            );
            expect(clear).toBe(true);
        });

        test('twelve ingredients: three in each of four columns', async ({ page }) => {
            const counts = await page.evaluate(() => ({
                total: ingredients.length,
                perCol: COL_X.map((_, c) => ingredients.filter(i => i.col === c).length),
            }));
            expect(counts.total).toBe(12);
            expect(counts.perCol).toEqual([3, 3, 3, 3]);
        });

        test('ingredients start unpressed, resting on floors 0-2', async ({ page }) => {
            const res = await page.evaluate(() => ({
                floors: [...new Set(ingredients.map(i => i.floor))].sort(),
                anyPressed: ingredients.some(i => i.segs.some(Boolean)),
                anyFalling: ingredients.some(i => i.falling || i.plated),
                segCount: ingredients.every(i => i.segs.length === 4),
            }));
            expect(res.floors).toEqual([0, 1, 2]);
            expect(res.anyPressed).toBe(false);
            expect(res.anyFalling).toBe(false);
            expect(res.segCount).toBe(true);
        });
    });

    // -----------------------------------------------------------------------
    // Pure helpers
    // -----------------------------------------------------------------------
    test.describe('geometry helpers', () => {
        test('columnAt maps x to a burger column, or -1 between columns', async ({ page }) => {
            const res = await page.evaluate(() => ({
                centre0: columnAt(COL_X[0]),
                edge0: columnAt(COL_X[0] + BURGER_W / 2 - 1),
                gap: columnAt((COL_X[0] + COL_X[1]) / 2),
                centre3: columnAt(COL_X[3]),
            }));
            expect(res.centre0).toBe(0);
            expect(res.edge0).toBe(0);
            expect(res.gap).toBe(-1);
            expect(res.centre3).toBe(3);
        });

        test('segIndexAt splits a column into four segments left to right', async ({ page }) => {
            const idx = await page.evaluate(() => {
                const left = COL_X[1] - BURGER_W / 2;
                return [0, 1, 2, 3].map(i => segIndexAt(1, left + i * SEG_W + SEG_W / 2));
            });
            expect(idx).toEqual([0, 1, 2, 3]);
        });

        test('nearestLadder snaps to the closest ladder', async ({ page }) => {
            const res = await page.evaluate(() => ({
                near0: nearestLadder(20),
                mid: nearestLadder(270),
                far: nearestLadder(559),
            }));
            expect(res.near0).toBe(16);
            expect(res.mid).toBe(272);
            expect(res.far).toBe(528);
        });
    });

    // -----------------------------------------------------------------------
    // Starting, pausing, game over
    // -----------------------------------------------------------------------
    test.describe('lifecycle', () => {
        test('Space dismisses the overlay and runs the game', async ({ page }) => {
            await page.keyboard.press('Space');
            await expect(page.locator('#overlay')).not.toHaveClass(/visible/);
            expect(await page.evaluate(() => state)).toBe('running');
        });

        test('the start button also starts the game', async ({ page }) => {
            await page.locator('#btn-start').click();
            expect(await page.evaluate(() => state)).toBe('running');
        });

        test('the chef starts on the bottom floor', async ({ page }) => {
            await page.keyboard.press('Space');
            expect(await page.evaluate(() => chef.floor)).toBe(4);
        });

        test('P pauses and resumes', async ({ page }) => {
            await page.keyboard.press('Space');
            await page.keyboard.press('p');
            expect(await page.evaluate(() => state)).toBe('paused');
            await page.keyboard.press('p');
            expect(await page.evaluate(() => state)).toBe('running');
        });

        test('a paused game does not advance', async ({ page }) => {
            await startAndPark(page);
            const moved = await page.evaluate(() => {
                state = 'paused';
                keys.right = true;
                const before = chef.x;
                update(200);
                keys.right = false;
                return chef.x !== before;
            });
            expect(moved).toBe(false);
        });

        test('losing the last life ends the game and shows the overlay', async ({ page }) => {
            await startAndPark(page);
            await page.evaluate(() => { lives = 1; loseLife(); });
            expect(await page.evaluate(() => state)).toBe('over');
            await expect(page.locator('#overlay')).toHaveClass(/visible/);
            await expect(page.locator('#lives')).toHaveText('0');
        });

        test('losing a life flashes the screen and clears the flash over time', async ({ page }) => {
            await startAndPark(page);
            const res = await page.evaluate(() => {
                loseLife();
                const lit = flash.ms;
                for (let t = 0; t < 60; t++) update(16);
                return { lit, faded: flash.ms };
            });
            expect(res.lit).toBeGreaterThan(0);
            expect(res.faded).toBeLessThanOrEqual(0);
        });

        test('game over stores the best score', async ({ page }) => {
            await startAndPark(page);
            const best = await page.evaluate(() => {
                score = 1234;
                lives = 1;
                loseLife();
                return localStorage.getItem('burgertime.best');
            });
            expect(best).toBe('1234');
            await expect(page.locator('#best')).toHaveText('1234');
        });
    });

    // -----------------------------------------------------------------------
    // Movement
    // -----------------------------------------------------------------------
    test.describe('movement', () => {
        test('holding ArrowRight walks the chef right', async ({ page }) => {
            await startAndPark(page);
            const dx = await page.evaluate(() => {
                const before = chef.x;
                keys.right = true;
                update(100);
                keys.right = false;
                return chef.x - before;
            });
            expect(dx).toBeGreaterThan(0);
        });

        test('holding ArrowLeft walks the chef left and flips his facing', async ({ page }) => {
            await startAndPark(page);
            const res = await page.evaluate(() => {
                const before = chef.x;
                keys.left = true;
                update(100);
                keys.left = false;
                return { dx: chef.x - before, dir: chef.dir };
            });
            expect(res.dx).toBeLessThan(0);
            expect(res.dir).toBe(-1);
        });

        test('the chef is clamped inside the canvas', async ({ page }) => {
            await startAndPark(page);
            const res = await page.evaluate(() => {
                chef.x = 4;
                keys.left = true;
                update(500);
                keys.left = false;
                const lo = chef.x;
                chef.x = WIDTH - 4;
                keys.right = true;
                update(500);
                keys.right = false;
                return { lo, hi: chef.x };
            });
            expect(res.lo).toBeGreaterThanOrEqual(0);
            expect(res.hi).toBeLessThanOrEqual(560);
        });

        test('keyboard events drive the same movement', async ({ page }) => {
            await startAndPark(page);
            const before = await page.evaluate(() => chef.x);
            await page.keyboard.down('ArrowRight');
            await page.waitForTimeout(200);
            await page.keyboard.up('ArrowRight');
            expect(await page.evaluate(() => chef.x)).toBeGreaterThan(before);
        });

        test('ArrowUp on a ladder climbs to the floor above', async ({ page }) => {
            await startAndPark(page);
            const res = await page.evaluate(() => {
                chef.x = LADDER_X[2];
                keys.up = true;
                update(50);
                const climbing = chef.climbing;
                update(3000);
                keys.up = false;
                return { climbing, floor: chef.floor, y: chef.y };
            });
            expect(res.climbing).toBe(true);
            expect(res.floor).toBe(3);
        });

        test('the chef cannot climb where there is no ladder', async ({ page }) => {
            await startAndPark(page);
            const res = await page.evaluate(() => {
                chef.x = COL_X[0];        // mid-column, far from any ladder
                keys.up = true;
                update(300);
                keys.up = false;
                return { climbing: chef.climbing, floor: chef.floor };
            });
            expect(res.climbing).toBe(false);
            expect(res.floor).toBe(4);
        });

        test('the chef cannot climb above the top floor or below the bottom floor', async ({ page }) => {
            await startAndPark(page);
            const res = await page.evaluate(() => {
                chef.x = LADDER_X[0];
                chef.floor = 0;
                chef.y = FLOOR_Y[0];
                keys.up = true;
                update(200);
                keys.up = false;
                const top = chef.floor;
                chef.floor = 4;
                chef.y = FLOOR_Y[4];
                keys.down = true;
                update(200);
                keys.down = false;
                return { top, bottom: chef.floor, climbing: chef.climbing };
            });
            expect(res.top).toBe(0);
            expect(res.bottom).toBe(4);
            expect(res.climbing).toBe(false);
        });

        test('horizontal input is ignored while climbing', async ({ page }) => {
            await startAndPark(page);
            const same = await page.evaluate(() => {
                chef.x = LADDER_X[1];
                keys.up = true;
                update(50);
                keys.up = false;
                const x = chef.x;
                keys.right = true;
                update(100);
                keys.right = false;
                return chef.climbing && chef.x === x;
            });
            expect(same).toBe(true);
        });
    });

    // -----------------------------------------------------------------------
    // Stomping ingredients
    // -----------------------------------------------------------------------
    test.describe('stomping', () => {
        test('standing on a segment presses exactly that segment', async ({ page }) => {
            await startAndPark(page);
            const segs = await page.evaluate(() => {
                const ing = ingredients.find(i => i.col === 1 && i.floor === 0);
                chef.floor = 0;
                chef.y = FLOOR_Y[0];
                chef.x = COL_X[1] - BURGER_W / 2 + SEG_W / 2;   // segment 0
                update(16);
                return [...ing.segs];
            });
            expect(segs).toEqual([true, false, false, false]);
        });

        test('walking across all four segments drops the ingredient one floor', async ({ page }) => {
            await startAndPark(page);
            const res = await page.evaluate(async () => {
                const ing = ingredients.find(i => i.col === 2 && i.floor === 0);
                chef.floor = 0;
                chef.y = FLOOR_Y[0];
                const left = COL_X[2] - BURGER_W / 2;
                for (let i = 0; i < 4; i++) {
                    chef.x = left + i * SEG_W + SEG_W / 2;
                    update(16);
                }
                const falling = ing.falling;
                for (let t = 0; t < 200 && ing.falling; t++) update(16);
                return { falling, floor: ing.floor, resting: !ing.falling, segs: ing.segs };
            });
            expect(res.falling).toBe(true);
            expect(res.resting).toBe(true);
            expect(res.floor).toBe(1);
            expect(res.segs).toEqual([false, false, false, false]);
        });

        test('a drop scores points', async ({ page }) => {
            await startAndPark(page);
            const gained = await page.evaluate(() => {
                const ing = ingredients.find(i => i.col === 0 && i.floor === 2);
                const before = score;
                dropIngredient(ing);
                for (let t = 0; t < 200 && ing.falling; t++) update(16);
                return score - before;
            });
            expect(gained).toBeGreaterThan(0);
        });

        test('an ingredient is not re-dropped while it is already falling', async ({ page }) => {
            await startAndPark(page);
            const target = await page.evaluate(() => {
                const ing = ingredients.find(i => i.col === 0 && i.floor === 0);
                dropIngredient(ing);
                const first = ing.targetFloor;
                dropIngredient(ing);
                return { first, second: ing.targetFloor };
            });
            expect(target.second).toBe(target.first);
        });

        test('landing on a resting ingredient pushes that one down a floor', async ({ page }) => {
            await startAndPark(page);
            const res = await page.evaluate(() => {
                const top = ingredients.find(i => i.col === 3 && i.floor === 0);
                const below = ingredients.find(i => i.col === 3 && i.floor === 1);
                dropIngredient(top);
                for (let t = 0; t < 400 && (top.falling || below.falling); t++) update(16);
                return { top: top.floor, below: below.floor };
            });
            expect(res.top).toBe(1);
            expect(res.below).toBe(2);
        });

        test('a push does not cascade past one floor per landing', async ({ page }) => {
            await startAndPark(page);
            const floors = await page.evaluate(() => {
                const col = ingredients.filter(i => i.col === 0).sort((a, b) => a.floor - b.floor);
                dropIngredient(col[0]);
                for (let t = 0; t < 600 && col.some(i => i.falling); t++) update(16);
                return col.map(i => i.floor);
            });
            expect(floors).toEqual([1, 2, 3]);
        });

        test('an ingredient dropped off the bottom floor is plated', async ({ page }) => {
            await startAndPark(page);
            const res = await page.evaluate(() => {
                const ing = ingredients.find(i => i.col === 1 && i.floor === 2);
                ing.floor = FLOOR_Y.length - 1;
                ing.y = FLOOR_Y[ing.floor];
                dropIngredient(ing);
                for (let t = 0; t < 400 && ing.falling; t++) update(16);
                return { plated: ing.plated, y: ing.y, plateY: PLATE_Y };
            });
            expect(res.plated).toBe(true);
            expect(res.y).toBeLessThanOrEqual(res.plateY);
        });

        test('plated ingredients stack instead of overlapping', async ({ page }) => {
            await startAndPark(page);
            const ys = await page.evaluate(() => {
                const col = ingredients.filter(i => i.col === 2);
                col.forEach(ing => {
                    ing.floor = FLOOR_Y.length - 1;
                    ing.y = FLOOR_Y[ing.floor];
                    ing.falling = false;
                    ing.plated = false;
                });
                col.forEach(ing => {
                    dropIngredient(ing);
                    for (let t = 0; t < 400 && ing.falling; t++) update(16);
                });
                return col.map(i => i.y).sort((a, b) => b - a);
            });
            expect(new Set(ys).size).toBe(3);
        });

        test('plating every ingredient clears the level', async ({ page }) => {
            await startAndPark(page);
            const res = await page.evaluate(() => {
                const before = score;
                ingredients.forEach(ing => {
                    ing.floor = FLOOR_Y.length - 1;
                    ing.y = FLOOR_Y[ing.floor];
                    dropIngredient(ing);
                });
                for (let t = 0; t < 600 && ingredients.some(i => i.falling); t++) update(16);
                update(16);
                return { level, gained: score - before, plated: ingredients.filter(i => i.plated).length };
            });
            expect(res.level).toBe(2);
            expect(res.gained).toBeGreaterThan(1000);
            expect(res.plated).toBeLessThan(12);   // level was rebuilt
        });
    });

    // -----------------------------------------------------------------------
    // Enemies
    // -----------------------------------------------------------------------
    test.describe('enemies', () => {
        test('a game starts with enemies on the board', async ({ page }) => {
            await page.keyboard.press('Space');
            expect(await page.evaluate(() => enemies.length)).toBeGreaterThan(0);
        });

        test('an enemy on the chef floor walks toward the chef', async ({ page }) => {
            await startAndPark(page);
            const dx = await page.evaluate(() => {
                enemies.push(makeEnemy(500, 4, 'dog'));
                const e = enemies[0];
                const before = Math.abs(e.x - chef.x);
                update(100);
                return before - Math.abs(e.x - chef.x);
            });
            expect(dx).toBeGreaterThan(0);
        });

        test('an enemy on another floor heads for a ladder and climbs', async ({ page }) => {
            await startAndPark(page);
            const res = await page.evaluate(() => {
                enemies.push(makeEnemy(200, 0, 'dog'));
                const e = enemies[0];
                for (let t = 0; t < 400 && e.floor === 0; t++) update(16);
                return { floor: e.floor, x: e.x };
            });
            expect(res.floor).toBeGreaterThan(0);
        });

        test('touching the chef costs a life and resets positions', async ({ page }) => {
            await startAndPark(page);
            const res = await page.evaluate(() => {
                enemies.push(makeEnemy(chef.x + 4, chef.floor, 'dog'));
                const before = lives;
                update(16);
                return { lost: before - lives, enemyFloor: enemies[0].floor, chefFloor: chef.floor };
            });
            expect(res.lost).toBe(1);
            expect(Math.abs(res.enemyFloor - res.chefFloor)).toBeGreaterThan(0);
        });

        test('a falling ingredient squashes an enemy for points', async ({ page }) => {
            await startAndPark(page);
            const res = await page.evaluate(() => {
                const ing = ingredients.find(i => i.col === 0 && i.floor === 0);
                enemies.push(makeEnemy(COL_X[0], 1, 'dog'));
                const e = enemies[0];
                const before = score;
                dropIngredient(ing);
                for (let t = 0; t < 400 && ing.falling; t++) update(16);
                return { gained: score - before, alive: e.alive, floor: ing.floor };
            });
            expect(res.alive).toBe(false);
            expect(res.gained).toBeGreaterThanOrEqual(500);
        });

        test('a squashed enemy carries the ingredient an extra floor', async ({ page }) => {
            await startAndPark(page);
            const floor = await page.evaluate(() => {
                const ing = ingredients.find(i => i.col === 1 && i.floor === 0);
                enemies.push(makeEnemy(COL_X[1], 1, 'dog'));
                dropIngredient(ing);
                for (let t = 0; t < 400 && ing.falling; t++) update(16);
                return ing.floor;
            });
            expect(floor).toBe(2);
        });

        test('a squashed enemy comes back', async ({ page }) => {
            await startAndPark(page);
            const back = await page.evaluate(() => {
                enemies.push(makeEnemy(COL_X[0], 1, 'dog'));
                const e = enemies[0];
                squash(e);
                for (let t = 0; t < 1000 && !e.alive; t++) update(16);
                return e.alive;
            });
            expect(back).toBe(true);
        });

        test('a dead enemy cannot hurt the chef', async ({ page }) => {
            await startAndPark(page);
            const lost = await page.evaluate(() => {
                const e = makeEnemy(chef.x, chef.floor, 'dog');
                e.alive = false;
                enemies.push(e);
                const before = lives;
                update(16);
                return before - lives;
            });
            expect(lost).toBe(0);
        });

        test('enemies get faster on later levels', async ({ page }) => {
            const faster = await page.evaluate(() => enemySpeed(4) > enemySpeed(1));
            expect(faster).toBe(true);
        });

        test('level 1 opens with two enemies', async ({ page }) => {
            expect(await page.evaluate(() => enemyCount(1))).toBe(2);
        });

        test('enemy count grows with the level but is capped', async ({ page }) => {
            const res = await page.evaluate(() => ({
                one: enemyCount(1),
                three: enemyCount(3),
                huge: enemyCount(99),
                cap: MAX_ENEMIES,
            }));
            expect(res.three).toBeGreaterThan(res.one);
            expect(res.huge).toBe(res.cap);
        });
    });

    // -----------------------------------------------------------------------
    // Pepper
    // -----------------------------------------------------------------------
    test.describe('pepper', () => {
        test('Space throws pepper and spends one', async ({ page }) => {
            await startAndPark(page);
            await page.keyboard.press('Space');
            expect(await page.evaluate(() => pepper)).toBe(4);
            expect(await page.evaluate(() => peppers.length)).toBe(1);
            await expect(page.locator('#pepper')).toHaveText('4');
        });

        test('pepper lands ahead of the chef', async ({ page }) => {
            await startAndPark(page);
            const ahead = await page.evaluate(() => {
                chef.dir = 1;
                throwPepper();
                return peppers[0].x > chef.x;
            });
            expect(ahead).toBe(true);
        });

        test('pepper stuns an enemy it touches', async ({ page }) => {
            await startAndPark(page);
            const res = await page.evaluate(() => {
                chef.dir = 1;
                enemies.push(makeEnemy(chef.x + PEPPER_REACH, chef.floor, 'dog'));
                const e = enemies[0];
                throwPepper();
                update(16);
                const stunned = e.stun > 0;
                const x = e.x;
                update(100);
                return { stunned, frozen: e.x === x };
            });
            expect(res.stunned).toBe(true);
            expect(res.frozen).toBe(true);
        });

        test('a stunned enemy recovers and resumes chasing', async ({ page }) => {
            await startAndPark(page);
            const moved = await page.evaluate(() => {
                const e = makeEnemy(500, 4, 'dog');
                e.stun = 50;
                enemies.push(e);
                update(60);
                const x = e.x;
                update(100);
                return e.x !== x;
            });
            expect(moved).toBe(true);
        });

        test('pepper clouds expire', async ({ page }) => {
            await startAndPark(page);
            const gone = await page.evaluate(() => {
                throwPepper();
                for (let t = 0; t < 200 && peppers.length; t++) update(16);
                return peppers.length;
            });
            expect(gone).toBe(0);
        });

        test('no pepper is thrown when the shaker is empty', async ({ page }) => {
            await startAndPark(page);
            const count = await page.evaluate(() => {
                pepper = 0;
                throwPepper();
                return { clouds: peppers.length, pepper };
            });
            expect(count.clouds).toBe(0);
            expect(count.pepper).toBe(0);
        });

        test('a new level refills the shaker', async ({ page }) => {
            await startAndPark(page);
            const refilled = await page.evaluate(() => {
                pepper = 0;
                ingredients.forEach(ing => {
                    ing.floor = FLOOR_Y.length - 1;
                    ing.y = FLOOR_Y[ing.floor];
                    dropIngredient(ing);
                });
                for (let t = 0; t < 600 && ingredients.some(i => i.falling); t++) update(16);
                update(16);
                return pepper;
            });
            expect(refilled).toBe(5);
        });
    });

    // -----------------------------------------------------------------------
    // Rendering
    // -----------------------------------------------------------------------
    test.describe('rendering', () => {
        test('the canvas is drawn, not blank', async ({ page }) => {
            await page.keyboard.press('Space');
            await page.waitForTimeout(120);
            const painted = await page.evaluate(() => {
                const data = ctx.getImageData(0, 0, WIDTH, HEIGHT).data;
                const seen = new Set();
                for (let i = 0; i < data.length; i += 4 * 97) {
                    seen.add(`${data[i]},${data[i + 1]},${data[i + 2]}`);
                }
                return seen.size;
            });
            expect(painted).toBeGreaterThan(3);
        });

        test('the animation loop advances the game on its own', async ({ page }) => {
            await page.keyboard.press('Space');
            await page.evaluate(() => { enemies.length = 0; enemies.push(makeEnemy(540, 4, 'dog')); });
            const before = await page.evaluate(() => enemies[0].x);
            await page.waitForTimeout(250);
            expect(await page.evaluate(() => enemies[0].x)).not.toBe(before);
        });

        test('no console errors during play', async ({ page }) => {
            const errors = [];
            page.on('pageerror', e => errors.push(e.message));
            await page.keyboard.press('Space');
            await page.keyboard.down('ArrowRight');
            await page.waitForTimeout(300);
            await page.keyboard.up('ArrowRight');
            await page.keyboard.press('Space');
            await page.waitForTimeout(200);
            expect(errors).toEqual([]);
        });
    });
});
