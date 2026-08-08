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

        test('canvas is 600x560', async ({ page }) => {
            const canvas = page.locator('#canvas');
            await expect(canvas).toHaveAttribute('width', '600');
            await expect(canvas).toHaveAttribute('height', '560');
        });

        test('state is idle before starting', async ({ page }) => {
            expect(await page.evaluate(() => state)).toBe('idle');
        });

        test('hud shows the starting score, lives, level and pepper', async ({ page }) => {
            await expect(page.locator('#score')).toHaveText('0');
            await expect(page.locator('#lives')).toHaveText('3');
            await expect(page.locator('#level')).toHaveText('1');
            await expect(page.locator('#pepper')).toHaveText('5');
        });

        test('best score loads from localStorage', async ({ page }) => {
            await page.evaluate(() => window.localStorage.setItem('burgertime-best', '4200'));
            await page.reload();
            await expect(page.locator('#best')).toHaveText('4200');
        });

        test('there are no ingredients or enemies before starting', async ({ page }) => {
            const counts = await page.evaluate(() => ({ i: ingredients.length, e: enemies.length }));
            expect(counts.i).toBe(0);
            expect(counts.e).toBe(0);
        });
    });

    // -----------------------------------------------------------------------
    // Starting a game
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

        test('the level is built with a full burger in every column', async ({ page }) => {
            const info = await page.evaluate(() => {
                startGame();
                return {
                    total: ingredients.length,
                    cols: COL_COUNT,
                    perBurger: INGREDIENT_TYPES.length,
                    perCol: [0, 1, 2, 3].map((c) => ingredients.filter((i) => i.col === c).length),
                };
            });
            expect(info.total).toBe(info.cols * info.perBurger);
            expect(info.perCol).toEqual([5, 5, 5, 5]);
        });

        test('every ingredient starts resting with un-stepped pieces', async ({ page }) => {
            const ok = await page.evaluate(() => {
                startGame();
                return ingredients.every(
                    (i) =>
                        i.state === 'rest' &&
                        i.pieces.length === PIECES_PER_INGREDIENT &&
                        i.pieces.every((p) => !p.stepped)
                );
            });
            expect(ok).toBe(true);
        });

        test('ingredients are spread down the floors above the plates', async ({ page }) => {
            const floors = await page.evaluate(() => {
                startGame();
                return ingredients.filter((i) => i.col === 0).map((i) => i.floor);
            });
            expect(floors).toEqual([0, 1, 2, 3, 4]);
            expect(Math.max(...floors)).toBeLessThan(await page.evaluate(() => PLATE_FLOOR));
        });

        test('the chef starts inside the play field with a full pepper supply', async ({ page }) => {
            const s = await page.evaluate(() => {
                startGame();
                return { x: chef.x, y: chef.y, pepper, lives, level, score };
            });
            expect(s.x).toBeGreaterThanOrEqual(0);
            expect(s.x).toBeLessThanOrEqual(600);
            expect(s.pepper).toBe(5);
            expect(s.lives).toBe(3);
            expect(s.level).toBe(1);
            expect(s.score).toBe(0);
        });
    });

    // -----------------------------------------------------------------------
    // Chef movement
    // -----------------------------------------------------------------------
    test.describe('chef movement', () => {
        test('walking right increases the chef x', async ({ page }) => {
            const { before, after } = await page.evaluate(() => {
                startGame();
                setChefTo(5, 300);
                const before = chef.x;
                setInput(1, 0);
                for (let i = 0; i < 20; i++) step(0.016);
                return { before, after: chef.x };
            });
            expect(after).toBeGreaterThan(before);
        });

        test('walking left decreases the chef x', async ({ page }) => {
            const { before, after } = await page.evaluate(() => {
                startGame();
                setChefTo(5, 300);
                const before = chef.x;
                setInput(-1, 0);
                for (let i = 0; i < 20; i++) step(0.016);
                return { before, after: chef.x };
            });
            expect(after).toBeLessThan(before);
        });

        test('the chef cannot walk off the left edge', async ({ page }) => {
            const x = await page.evaluate(() => {
                startGame();
                setChefTo(5, 300);
                setInput(-1, 0);
                for (let i = 0; i < 600; i++) step(0.016);
                return chef.x;
            });
            expect(x).toBeGreaterThanOrEqual(await page.evaluate(() => WALK_MIN));
        });

        test('the chef cannot walk off the right edge', async ({ page }) => {
            const x = await page.evaluate(() => {
                startGame();
                setChefTo(5, 300);
                setInput(1, 0);
                for (let i = 0; i < 600; i++) step(0.016);
                return chef.x;
            });
            expect(x).toBeLessThanOrEqual(await page.evaluate(() => WALK_MAX));
        });

        test('the chef cannot climb where there is no ladder', async ({ page }) => {
            const { before, after } = await page.evaluate(() => {
                startGame();
                // Half way between two ladders is solid floor.
                setChefTo(5, (LADDER_XS[1] + LADDER_XS[2]) / 2);
                const before = chef.y;
                setInput(0, -1);
                for (let i = 0; i < 40; i++) step(0.016);
                return { before, after: chef.y };
            });
            expect(after).toBe(before);
        });

        test('the chef climbs up a ladder to the floor above', async ({ page }) => {
            const res = await page.evaluate(() => {
                startGame();
                setChefTo(5, LADDER_XS[2]);
                setInput(0, -1);
                for (let i = 0; i < 200; i++) {
                    step(0.016);
                    if (chef.y <= FLOOR_YS[4]) break;
                }
                setInput(0, 0);
                step(0.016);
                return { y: chef.y, floor: chef.floor, target: FLOOR_YS[4] };
            });
            expect(res.y).toBeLessThanOrEqual(res.target + 6);
            expect(res.floor).toBe(4);
        });

        test('climbing snaps the chef onto the ladder centre', async ({ page }) => {
            const x = await page.evaluate(() => {
                startGame();
                setChefTo(5, LADDER_XS[2] + 4);
                setInput(0, -1);
                for (let i = 0; i < 20; i++) step(0.016);
                return chef.x;
            });
            expect(x).toBe(await page.evaluate(() => LADDER_XS[2]));
        });

        test('the chef cannot climb above the top floor', async ({ page }) => {
            const y = await page.evaluate(() => {
                startGame();
                setChefTo(0, LADDER_XS[2]);
                setInput(0, -1);
                for (let i = 0; i < 200; i++) step(0.016);
                return chef.y;
            });
            expect(y).toBe(await page.evaluate(() => FLOOR_YS[0]));
        });

        test('the chef cannot climb below the plate floor', async ({ page }) => {
            const y = await page.evaluate(() => {
                startGame();
                setChefTo(PLATE_FLOOR, LADDER_XS[2]);
                setInput(0, 1);
                for (let i = 0; i < 200; i++) step(0.016);
                return chef.y;
            });
            expect(y).toBe(await page.evaluate(() => FLOOR_YS[PLATE_FLOOR]));
        });

        test('arrow keys drive the chef', async ({ page }) => {
            await page.evaluate(() => {
                startGame();
                setChefTo(5, 300);
            });
            const before = await page.evaluate(() => chef.x);
            await page.keyboard.down('ArrowRight');
            await page.evaluate(() => {
                for (let i = 0; i < 20; i++) step(0.016);
            });
            await page.keyboard.up('ArrowRight');
            const after = await page.evaluate(() => chef.x);
            expect(after).toBeGreaterThan(before);
        });
    });

    // -----------------------------------------------------------------------
    // Stepping on ingredients
    // -----------------------------------------------------------------------
    test.describe('stepping on ingredients', () => {
        test('walking over a piece marks just that piece as stepped', async ({ page }) => {
            const pieces = await page.evaluate(() => {
                startGame();
                const ing = ingredients.find((i) => i.col === 1 && i.floor === 2);
                setChefTo(ing.floor, pieceCenterX(ing.col, 0) - 14);
                setInput(1, 0);
                for (let i = 0; i < 12; i++) step(0.016);
                setInput(0, 0);
                return ing.pieces.map((p) => p.stepped);
            });
            expect(pieces[0]).toBe(true);
            expect(pieces.slice(1)).toEqual([false, false, false]);
        });

        test('an ingredient with only some pieces stepped stays resting', async ({ page }) => {
            const s = await page.evaluate(() => {
                startGame();
                const ing = ingredients.find((i) => i.col === 1 && i.floor === 2);
                ing.pieces[0].stepped = true;
                ing.pieces[1].stepped = true;
                for (let i = 0; i < 30; i++) step(0.016);
                return ing.state;
            });
            expect(s).toBe('rest');
        });

        test('walking the whole ingredient makes it fall', async ({ page }) => {
            const res = await page.evaluate(() => {
                startGame();
                const ing = ingredients.find((i) => i.col === 1 && i.floor === 2);
                setChefTo(ing.floor, columnX(ing.col) - 16);
                setInput(1, 0);
                for (let i = 0; i < 200; i++) {
                    step(0.016);
                    if (ing.state !== 'rest') break;
                }
                return { state: ing.state, stepped: ing.pieces.every((p) => p.stepped) };
            });
            expect(res.stepped).toBe(true);
            expect(res.state).toBe('fall');
        });

        test('dropping an ingredient scores points', async ({ page }) => {
            const score = await page.evaluate(() => {
                startGame();
                const ing = ingredients.find((i) => i.col === 1 && i.floor === 2);
                dropIngredient(ing);
                return score;
            });
            expect(score).toBeGreaterThan(0);
        });

        test('the chef cannot step an ingredient on another floor', async ({ page }) => {
            const stepped = await page.evaluate(() => {
                startGame();
                const ing = ingredients.find((i) => i.col === 1 && i.floor === 2);
                setChefTo(4, columnX(ing.col) - 16);
                setInput(1, 0);
                for (let i = 0; i < 120; i++) step(0.016);
                return ing.pieces.some((p) => p.stepped);
            });
            expect(stepped).toBe(false);
        });
    });

    // -----------------------------------------------------------------------
    // Falling and plating
    // -----------------------------------------------------------------------
    test.describe('falling ingredients', () => {
        test('a falling ingredient moves downward', async ({ page }) => {
            const { before, after } = await page.evaluate(() => {
                startGame();
                const ing = ingredients.find((i) => i.col === 0 && i.floor === 0);
                dropIngredient(ing);
                const before = ing.y;
                step(0.05);
                return { before, after: ing.y };
            });
            expect(after).toBeGreaterThan(before);
        });

        test('a falling ingredient lands and rests on the next floor down', async ({ page }) => {
            const res = await page.evaluate(() => {
                startGame();
                // Clear the column so nothing is pushed on the way down.
                const col = 0;
                const ing = ingredients.find((i) => i.col === col && i.floor === 0);
                ingredients = ingredients.filter((i) => i.col !== col || i === ing);
                dropIngredient(ing);
                for (let i = 0; i < 200; i++) {
                    step(0.016);
                    if (ing.state === 'rest') break;
                }
                return { state: ing.state, floor: ing.floor, y: ing.y, floorY: FLOOR_YS[1] };
            });
            expect(res.state).toBe('rest');
            expect(res.floor).toBe(1);
            expect(res.y).toBe(res.floorY);
        });

        test('landing resets the ingredient pieces so it must be walked again', async ({ page }) => {
            const stepped = await page.evaluate(() => {
                startGame();
                const col = 0;
                const ing = ingredients.find((i) => i.col === col && i.floor === 0);
                ingredients = ingredients.filter((i) => i.col !== col || i === ing);
                dropIngredient(ing);
                for (let i = 0; i < 200; i++) {
                    step(0.016);
                    if (ing.state === 'rest') break;
                }
                return ing.pieces.some((p) => p.stepped);
            });
            expect(stepped).toBe(false);
        });

        test('a falling ingredient pushes a resting ingredient below it', async ({ page }) => {
            const res = await page.evaluate(() => {
                startGame();
                const top = ingredients.find((i) => i.col === 2 && i.floor === 0);
                const below = ingredients.find((i) => i.col === 2 && i.floor === 1);
                dropIngredient(top);
                for (let i = 0; i < 60; i++) {
                    step(0.016);
                    if (below.state === 'fall') break;
                }
                return { below: below.state, top: top.state };
            });
            expect(res.below).toBe('fall');
            expect(res.top).toBe('fall');
        });

        test('an ingredient that reaches the plate becomes plated', async ({ page }) => {
            const res = await page.evaluate(() => {
                startGame();
                const col = 3;
                const ing = ingredients.find((i) => i.col === col && i.floor === 4);
                ingredients = ingredients.filter((i) => i.col !== col || i === ing);
                dropIngredient(ing);
                for (let i = 0; i < 400; i++) {
                    step(0.016);
                    if (ing.state === 'plated') break;
                }
                return { state: ing.state, floor: ing.floor, plated: platedCount(col) };
            });
            expect(res.state).toBe('plated');
            expect(res.floor).toBe(await page.evaluate(() => PLATE_FLOOR));
            expect(res.plated).toBe(1);
        });

        test('plated ingredients stack on top of each other', async ({ page }) => {
            const ys = await page.evaluate(() => {
                startGame();
                const col = 3;
                const stack = ingredients.filter((i) => i.col === col);
                ingredients = ingredients.filter((i) => i.col === col);
                lives = 99; // keep the run alive while the whole stack is plated
                // Walk them all down by repeatedly dropping whatever is resting.
                for (let n = 0; n < 3000; n++) {
                    const resting = ingredients.find((i) => i.state === 'rest');
                    if (resting) dropIngredient(resting);
                    step(0.016);
                    if (ingredients.every((i) => i.state === 'plated')) break;
                }
                return stack.map((i) => i.y).sort((a, b) => a - b);
            });
            // Five distinct stacked heights, each one ingredient thick.
            expect(new Set(ys).size).toBe(5);
        });

        test('a cascade plates the layers in burger order, bun bottom first', async ({ page }) => {
            const order = await page.evaluate(() => {
                startGame();
                lives = 99;
                const col = 1;
                const top = ingredients.find((i) => i.col === col && i.floor === 0);
                dropIngredient(top);
                for (let i = 0; i < 2000; i++) {
                    step(0.016);
                    if (ingredients.filter((i2) => i2.col === col).every((i2) => i2.state === 'plated')) break;
                }
                return ingredients
                    .filter((i) => i.col === col && i.state === 'plated')
                    .sort((a, b) => b.y - a.y) // bottom of the stack first
                    .map((i) => i.type);
            });
            expect(order).toEqual(['bunBottom', 'cheese', 'patty', 'lettuce', 'bunTop']);
        });

        test('a falling ingredient squashes an enemy and scores a bonus', async ({ page }) => {
            const res = await page.evaluate(() => {
                startGame();
                const col = 0;
                const ing = ingredients.find((i) => i.col === col && i.floor === 0);
                ingredients = ingredients.filter((i) => i.col !== col || i === ing);
                enemies.length = 0;
                spawnEnemy('dog', 1, columnX(col) + COL_W / 2);
                enemies[0].stun = 10; // hold it still under the falling ingredient
                const before = score;
                dropIngredient(ing);
                for (let i = 0; i < 200; i++) {
                    step(0.016);
                    if (enemies.length === 0) break;
                }
                return { enemies: enemies.length, gained: score - before };
            });
            expect(res.enemies).toBe(0);
            expect(res.gained).toBeGreaterThan(50);
        });
    });

    // -----------------------------------------------------------------------
    // Enemies
    // -----------------------------------------------------------------------
    test.describe('enemies', () => {
        test('spawnEnemy places an enemy on the requested floor', async ({ page }) => {
            const e = await page.evaluate(() => {
                startGame();
                enemies.length = 0;
                spawnEnemy('egg', 3, 200);
                return { n: enemies.length, x: enemies[0].x, y: enemies[0].y, floorY: FLOOR_YS[3] };
            });
            expect(e.n).toBe(1);
            expect(e.x).toBe(200);
            expect(e.y).toBe(e.floorY);
        });

        test('an enemy on the same floor walks toward the chef', async ({ page }) => {
            const res = await page.evaluate(() => {
                startGame();
                enemies.length = 0;
                setChefTo(3, 120);
                spawnEnemy('dog', 3, 500);
                const before = enemies[0].x;
                for (let i = 0; i < 30; i++) step(0.016);
                return { before, after: enemies[0].x };
            });
            expect(res.after).toBeLessThan(res.before);
        });

        test('an enemy on another floor heads for a ladder', async ({ page }) => {
            const res = await page.evaluate(() => {
                startGame();
                enemies.length = 0;
                setChefTo(1, 300);
                spawnEnemy('pickle', 4, 250);
                const e = enemies[0];
                const before = e.y;
                for (let i = 0; i < 400; i++) {
                    step(0.016);
                    if (e.y < before) break;
                }
                return { before, after: e.y };
            });
            expect(res.after).toBeLessThan(res.before);
        });

        test('enemies spawn automatically over time', async ({ page }) => {
            const n = await page.evaluate(() => {
                startGame();
                enemies.length = 0;
                lives = 99;
                for (let i = 0; i < 900; i++) {
                    step(0.016);
                    if (enemies.length > 0) break;
                }
                return enemies.length;
            });
            expect(n).toBeGreaterThan(0);
        });

        test('touching an enemy costs a life and resets the chef', async ({ page }) => {
            const res = await page.evaluate(() => {
                startGame();
                enemies.length = 0;
                setChefTo(3, 300);
                spawnEnemy('dog', 3, 302);
                step(0.016);
                return { lives, enemies: enemies.length };
            });
            expect(res.lives).toBe(2);
            expect(res.enemies).toBe(0);
        });

        test('losing the last life ends the game', async ({ page }) => {
            const s = await page.evaluate(() => {
                startGame();
                lives = 1;
                enemies.length = 0;
                setChefTo(3, 300);
                spawnEnemy('dog', 3, 302);
                step(0.016);
                return state;
            });
            expect(s).toBe('over');
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
    // Pepper
    // -----------------------------------------------------------------------
    test.describe('pepper', () => {
        test('throwing pepper uses one shot and makes a cloud', async ({ page }) => {
            const res = await page.evaluate(() => {
                startGame();
                setChefTo(3, 300);
                throwPepper();
                return { pepper, clouds: peppers.length };
            });
            expect(res.pepper).toBe(4);
            expect(res.clouds).toBe(1);
        });

        test('pepper cannot be thrown when the supply is empty', async ({ page }) => {
            const res = await page.evaluate(() => {
                startGame();
                pepper = 0;
                peppers.length = 0;
                const ok = throwPepper();
                return { ok, clouds: peppers.length, pepper };
            });
            expect(res.ok).toBe(false);
            expect(res.clouds).toBe(0);
            expect(res.pepper).toBe(0);
        });

        test('pepper stuns an enemy in front of the chef', async ({ page }) => {
            const stun = await page.evaluate(() => {
                startGame();
                enemies.length = 0;
                setChefTo(3, 300);
                chef.dir = 1;
                spawnEnemy('dog', 3, 300 + PEPPER_REACH);
                throwPepper();
                step(0.016);
                return enemies[0] ? enemies[0].stun : -1;
            });
            expect(stun).toBeGreaterThan(0);
        });

        test('a stunned enemy stops moving', async ({ page }) => {
            const res = await page.evaluate(() => {
                startGame();
                enemies.length = 0;
                setChefTo(3, 120);
                spawnEnemy('dog', 3, 400);
                enemies[0].stun = 5;
                const before = enemies[0].x;
                for (let i = 0; i < 40; i++) step(0.016);
                return { before, after: enemies[0].x };
            });
            expect(res.after).toBe(res.before);
        });

        test('a stunned enemy does not hurt the chef', async ({ page }) => {
            const remaining = await page.evaluate(() => {
                startGame();
                enemies.length = 0;
                setChefTo(3, 300);
                spawnEnemy('dog', 3, 302);
                enemies[0].stun = 5;
                step(0.016);
                return lives;
            });
            expect(remaining).toBe(3);
        });

        test('the pepper cloud fades away', async ({ page }) => {
            const n = await page.evaluate(() => {
                startGame();
                setChefTo(3, 300);
                throwPepper();
                for (let i = 0; i < 120; i++) step(0.016);
                return peppers.length;
            });
            expect(n).toBe(0);
        });

        test('the hud shows the remaining pepper', async ({ page }) => {
            await page.evaluate(() => {
                startGame();
                setChefTo(3, 300);
                throwPepper();
            });
            await expect(page.locator('#pepper')).toHaveText('4');
        });
    });

    // -----------------------------------------------------------------------
    // Level completion
    // -----------------------------------------------------------------------
    test.describe('levels', () => {
        test('allPlated is false while ingredients remain up top', async ({ page }) => {
            expect(
                await page.evaluate(() => {
                    startGame();
                    return allPlated();
                })
            ).toBe(false);
        });

        test('plating every ingredient completes the level', async ({ page }) => {
            const res = await page.evaluate(() => {
                startGame();
                ingredients.forEach((i) => {
                    i.state = 'plated';
                });
                step(0.016);
                return { level, plated: ingredients.filter((i) => i.state === 'plated').length };
            });
            expect(res.level).toBe(2);
            // A fresh burger stack was rebuilt for the new level.
            expect(res.plated).toBe(0);
        });

        test('completing a level awards a bonus and refills the pepper', async ({ page }) => {
            const res = await page.evaluate(() => {
                startGame();
                pepper = 1;
                score = 0;
                ingredients.forEach((i) => {
                    i.state = 'plated';
                });
                step(0.016);
                return { score, pepper };
            });
            expect(res.score).toBeGreaterThanOrEqual(1000);
            expect(res.pepper).toBe(5);
        });

        test('a chef who walks every layer down actually clears the level', async ({ page }) => {
            // Full-loop integration check: a simple bot repeatedly walks the
            // highest resting layer across its column until the burgers are
            // built. Proves stepping, cascading and plating hang together.
            const res = await page.evaluate(() => {
                startGame();
                lives = 99;
                const startLevel = level;
                let current = null;
                for (let guard = 0; guard < 20000; guard++) {
                    if (level > startLevel) break;
                    enemies.length = 0; // this bot does not dodge
                    const target = ingredients.find((i) => i.state === 'rest');
                    if (target && (target !== current || chef.floor !== target.floor)) {
                        setChefTo(target.floor, columnX(target.col) - 4);
                        setInput(1, 0);
                        current = target;
                    }
                    step(0.016);
                }
                return { level, startLevel, score };
            });
            expect(res.level).toBe(res.startLevel + 1);
            expect(res.score).toBeGreaterThan(1000);
        });

        test('enemies move faster on later levels', async ({ page }) => {
            const res = await page.evaluate(() => {
                startGame();
                level = 1;
                enemies.length = 0;
                spawnEnemy('dog', 3, 300);
                const slow = enemies[0].speed;
                level = 5;
                enemies.length = 0;
                spawnEnemy('dog', 3, 300);
                return { slow, fast: enemies[0].speed };
            });
            expect(res.fast).toBeGreaterThan(res.slow);
        });
    });

    // -----------------------------------------------------------------------
    // Pause, restart and scoring
    // -----------------------------------------------------------------------
    test.describe('pause, restart and scoring', () => {
        test('pausing freezes falling ingredients', async ({ page }) => {
            const res = await page.evaluate(() => {
                startGame();
                const ing = ingredients.find((i) => i.col === 0 && i.floor === 0);
                dropIngredient(ing);
                togglePause();
                const before = ing.y;
                for (let i = 0; i < 20; i++) step(0.016);
                return { before, after: ing.y, state };
            });
            expect(res.state).toBe('paused');
            expect(res.after).toBe(res.before);
        });

        test('resuming lets the game run again', async ({ page }) => {
            const moved = await page.evaluate(() => {
                startGame();
                const ing = ingredients.find((i) => i.col === 0 && i.floor === 0);
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
            await page.keyboard.press('KeyP');
            expect(await page.evaluate(() => state)).toBe('paused');
            await page.keyboard.press('KeyP');
            expect(await page.evaluate(() => state)).toBe('running');
        });

        test('restarting resets score, lives, level and the burgers', async ({ page }) => {
            const res = await page.evaluate(() => {
                startGame();
                score = 5000;
                lives = 1;
                level = 4;
                endGame();
                startGame();
                return {
                    score,
                    lives,
                    level,
                    state,
                    ingredients: ingredients.length,
                    resting: ingredients.every((i) => i.state === 'rest'),
                };
            });
            expect(res.score).toBe(0);
            expect(res.lives).toBe(3);
            expect(res.level).toBe(1);
            expect(res.state).toBe('running');
            expect(res.ingredients).toBe(20);
            expect(res.resting).toBe(true);
        });

        test('best score updates on game over when beaten', async ({ page }) => {
            await page.evaluate(() => {
                startGame();
                score = 7777;
                updateHud();
                endGame();
            });
            await expect(page.locator('#best')).toHaveText('7777');
            const stored = await page.evaluate(() => window.localStorage.getItem('burgertime-best'));
            expect(parseInt(stored, 10)).toBe(7777);
        });

        test('best score is not lowered by a worse run', async ({ page }) => {
            await page.evaluate(() => window.localStorage.setItem('burgertime-best', '9999'));
            await page.reload();
            await page.evaluate(() => {
                startGame();
                score = 10;
                updateHud();
                endGame();
            });
            await expect(page.locator('#best')).toHaveText('9999');
        });

        test('the canvas actually renders something', async ({ page }) => {
            await page.evaluate(() => startGame());
            const blank = await page.evaluate(() => {
                const c = document.getElementById('canvas');
                const data = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
                for (let i = 0; i < data.length; i += 4) {
                    if (data[i] !== data[0] || data[i + 1] !== data[1] || data[i + 2] !== data[2]) {
                        return false;
                    }
                }
                return true;
            });
            expect(blank).toBe(false);
        });
    });
});
