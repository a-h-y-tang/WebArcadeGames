const { test, expect } = require('@playwright/test');
const path = require('path');
const { pathToFileURL } = require('url');

const GAME_URL = pathToFileURL(path.resolve(__dirname, '../index.html')).href;

// Simulate `frames` fixed 60fps ticks inside the page.
const FRAMES = (frames) => `for (let i = 0; i < ${frames}; i++) step(1 / 60);`;

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

        test('start overlay is visible and prompts the player', async ({ page }) => {
            await expect(page.locator('#overlay')).toHaveClass(/visible/);
            await expect(page.locator('#overlay-sub')).toContainText(/space|start/i);
        });

        test('HUD starts at zero score, 3 lives, level 1, 5 peppers', async ({ page }) => {
            await expect(page.locator('#score')).toHaveText('0');
            await expect(page.locator('#lives')).toHaveText('3');
            await expect(page.locator('#level')).toHaveText('1');
            await expect(page.locator('#pepper')).toHaveText('5');
            await expect(page.locator('#best')).toHaveText('0');
        });

        test('canvas is 640x480', async ({ page }) => {
            await expect(page.locator('#canvas')).toHaveAttribute('width', '640');
            await expect(page.locator('#canvas')).toHaveAttribute('height', '480');
        });

        test('state is idle and no enemies exist before starting', async ({ page }) => {
            expect(await page.evaluate(() => state)).toBe('idle');
            expect(await page.evaluate(() => enemies.length)).toBe(0);
        });

        test('best score loads from localStorage', async ({ page }) => {
            await page.evaluate(() => localStorage.setItem('burgertime-best', '4200'));
            await page.reload();
            await expect(page.locator('#best')).toHaveText('4200');
        });
    });

    // -----------------------------------------------------------------------
    // Level geometry
    // -----------------------------------------------------------------------
    test.describe('level layout', () => {
        test('there are six floors, the last of which is the plate row', async ({ page }) => {
            const { floors, plate } = await page.evaluate(() => ({
                floors: FLOOR_Y.length,
                plate: PLATE_LEVEL,
            }));
            expect(floors).toBe(6);
            expect(plate).toBe(5);
        });

        test('floors are ordered top to bottom and fit the canvas', async ({ page }) => {
            const ok = await page.evaluate(() => FLOOR_Y.every((y, i) =>
                y > 0 && y < CANVAS_H && (i === 0 || y > FLOOR_Y[i - 1])));
            expect(ok).toBe(true);
        });

        test('every gap between floors has at least two ladders', async ({ page }) => {
            const counts = await page.evaluate(() => FLOOR_Y.slice(1).map((_, gap) =>
                LADDERS.filter((l) => l.gap === gap).length));
            expect(counts).toHaveLength(5);
            for (const count of counts) expect(count).toBeGreaterThanOrEqual(2);
        });

        test('all ladders sit inside the play field', async ({ page }) => {
            const ok = await page.evaluate(() => LADDERS.every((l) => l.x > 0 && l.x < CANVAS_W));
            expect(ok).toBe(true);
        });

        test('all four burger columns fit inside the play field', async ({ page }) => {
            const ok = await page.evaluate(() => COLUMN_X.length === 4 &&
                COLUMN_X.every((x) => x - ING_W / 2 >= 0 && x + ING_W / 2 <= CANVAS_W));
            expect(ok).toBe(true);
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

        test('a fresh game has level 1, 3 lives, 5 peppers and no score', async ({ page }) => {
            const s = await page.evaluate(() => { startGame(); return { level, lives, pepper, score }; });
            expect(s).toEqual({ level: 1, lives: 3, pepper: 5, score: 0 });
        });

        test('the board is stocked with 16 ingredients, four per column', async ({ page }) => {
            const perColumn = await page.evaluate(() => {
                startGame();
                return COLUMN_X.map((_, col) => ingredients.filter((i) => i.col === col).length);
            });
            expect(perColumn).toEqual([4, 4, 4, 4]);
        });

        test('ingredients start stacked on floors 0-3 and none are plated', async ({ page }) => {
            const s = await page.evaluate(() => {
                startGame();
                return {
                    levels: [...new Set(ingredients.map((i) => i.level))].sort(),
                    plated: ingredients.filter((i) => i.level === PLATE_LEVEL).length,
                    falling: ingredients.filter((i) => i.falling).length,
                };
            });
            expect(s.levels).toEqual([0, 1, 2, 3]);
            expect(s.plated).toBe(0);
            expect(s.falling).toBe(0);
        });

        test('the chef starts on the bottom floor inside the play field', async ({ page }) => {
            const c = await page.evaluate(() => { startGame(); return { ...chef }; });
            expect(c.floor).toBe(5);
            expect(c.x).toBeGreaterThan(0);
            expect(c.x).toBeLessThan(640);
        });
    });

    // -----------------------------------------------------------------------
    // Chef movement
    // -----------------------------------------------------------------------
    test.describe('chef movement', () => {
        test('walking right increases x, walking left decreases it', async ({ page }) => {
            const right = await page.evaluate(`(() => {
                startGame(); placeChef(320, 5); setChefInput(1, 0);
                ${FRAMES(20)}
                return chef.x;
            })()`);
            const left = await page.evaluate(`(() => {
                startGame(); placeChef(320, 5); setChefInput(-1, 0);
                ${FRAMES(20)}
                return chef.x;
            })()`);
            expect(right).toBeGreaterThan(320);
            expect(left).toBeLessThan(320);
        });

        test('the chef cannot walk off either edge', async ({ page }) => {
            const bounds = await page.evaluate(`(() => {
                startGame(); placeChef(320, 5); setChefInput(-1, 0);
                ${FRAMES(600)}
                const min = chef.x;
                setChefInput(1, 0);
                ${FRAMES(600)}
                return { min, max: chef.x };
            })()`);
            expect(bounds.min).toBeGreaterThanOrEqual(0);
            expect(bounds.max).toBeLessThanOrEqual(640);
        });

        test('the chef stays on his floor where there is no ladder', async ({ page }) => {
            const floor = await page.evaluate(`(() => {
                startGame();
                const gap4 = LADDERS.filter((l) => l.gap === 4).map((l) => l.x);
                let x = 5;
                while (gap4.some((lx) => Math.abs(lx - x) < 60)) x += 10;
                placeChef(x, 5); setChefInput(0, -1);
                ${FRAMES(120)}
                return chef.floor;
            })()`);
            expect(floor).toBe(5);
        });

        test('the chef climbs up a ladder to the floor above', async ({ page }) => {
            const s = await page.evaluate(`(() => {
                startGame();
                const ladder = LADDERS.find((l) => l.gap === 4);
                placeChef(ladder.x, 5); setChefInput(0, -1);
                ${FRAMES(180)}
                return { floor: chef.floor, y: chef.y, climbing: chef.climbing };
            })()`);
            expect(s.floor).toBe(4);
            expect(s.climbing).toBe(false);
        });

        test('the chef climbs down a ladder to the floor below', async ({ page }) => {
            const floor = await page.evaluate(`(() => {
                startGame();
                const ladder = LADDERS.find((l) => l.gap === 0);
                placeChef(ladder.x, 0); setChefInput(0, 1);
                ${FRAMES(180)}
                return chef.floor;
            })()`);
            expect(floor).toBe(1);
        });

        test('the chef y tracks the floor he is standing on', async ({ page }) => {
            const s = await page.evaluate(() => {
                startGame();
                placeChef(320, 2);
                step(1 / 60);
                return { y: chef.y, floorY: FLOOR_Y[2] };
            });
            expect(s.y).toBeCloseTo(s.floorY, 1);
        });

        test('climbing snaps the chef horizontally onto the ladder', async ({ page }) => {
            const s = await page.evaluate(`(() => {
                startGame();
                const ladder = LADDERS.find((l) => l.gap === 4);
                placeChef(ladder.x + LADDER_SNAP - 1, 5); setChefInput(0, -1);
                ${FRAMES(10)}
                return { x: chef.x, ladderX: ladder.x, climbing: chef.climbing };
            })()`);
            expect(s.climbing).toBe(true);
            expect(s.x).toBeCloseTo(s.ladderX, 1);
        });
    });

    // -----------------------------------------------------------------------
    // Flipping ingredients
    // -----------------------------------------------------------------------
    test.describe('flipping ingredients', () => {
        // Walk the chef fully across the ingredient resting at (col, level).
        const walkAcross = (col, level) => `
            const ing = ingredientAt(${col}, ${level});
            placeChef(COLUMN_X[${col}] - ING_W / 2 - 6, ${level});
            setChefInput(1, 0);
            for (let i = 0; i < 600 && !ing.falling && ing.level === ${level}; i++) step(1 / 60);
        `;

        test('walking across an ingredient presses all four segments and drops it', async ({ page }) => {
            const s = await page.evaluate(`(() => {
                startGame();
                ${walkAcross(0, 3)}
                return { pressed: ing.segments.filter(Boolean).length, moved: ing.falling || ing.level > 3 };
            })()`);
            expect(s.pressed).toBe(4);
            expect(s.moved).toBe(true);
        });

        test('walking only partway across presses some segments but does not drop it', async ({ page }) => {
            const s = await page.evaluate(`(() => {
                startGame();
                const ing = ingredientAt(0, 3);
                placeChef(COLUMN_X[0] - ING_W / 2 - 6, 3);
                setChefInput(1, 0);
                while (chef.x < COLUMN_X[0] - ING_W / 4) step(1 / 60);
                setChefInput(0, 0);
                step(1 / 60);
                return { pressed: ing.segments.filter(Boolean).length, level: ing.level, falling: ing.falling };
            })()`);
            expect(s.pressed).toBeGreaterThan(0);
            expect(s.pressed).toBeLessThan(4);
            expect(s.falling).toBe(false);
            expect(s.level).toBe(3);
        });

        test('walking past an ingredient on another floor presses nothing', async ({ page }) => {
            const pressed = await page.evaluate(`(() => {
                startGame();
                const ing = ingredientAt(0, 3);
                placeChef(COLUMN_X[0] - ING_W / 2 - 6, 4);
                setChefInput(1, 0);
                ${FRAMES(180)}
                return ing.segments.filter(Boolean).length;
            })()`);
            expect(pressed).toBe(0);
        });

        test('a dropped ingredient falls and comes to rest one floor lower', async ({ page }) => {
            const s = await page.evaluate(`(() => {
                startGame();
                // Clear the column below so nothing is knocked loose.
                ingredients = ingredients.filter((i) => !(i.col === 0 && i.level > 0));
                const ing = ingredientAt(0, 0);
                placeChef(COLUMN_X[0] - ING_W / 2 - 6, 0);
                setChefInput(1, 0);
                for (let i = 0; i < 900 && (ing.level === 0 || ing.falling); i++) step(1 / 60);
                return { level: ing.level, falling: ing.falling, y: ing.y, restY: FLOOR_Y[1] };
            })()`);
            expect(s.level).toBe(1);
            expect(s.falling).toBe(false);
            expect(s.y).toBeLessThanOrEqual(s.restY);
        });

        test('a landed ingredient has its segments reset so it can be flipped again', async ({ page }) => {
            const pressed = await page.evaluate(`(() => {
                startGame();
                ingredients = ingredients.filter((i) => !(i.col === 0 && i.level > 0));
                const ing = ingredientAt(0, 0);
                placeChef(COLUMN_X[0] - ING_W / 2 - 6, 0);
                setChefInput(1, 0);
                for (let i = 0; i < 900 && (ing.level === 0 || ing.falling); i++) step(1 / 60);
                return ing.segments.filter(Boolean).length;
            })()`);
            expect(pressed).toBe(0);
        });

        test('landing on a resting ingredient knocks the whole stack down one floor', async ({ page }) => {
            const levels = await page.evaluate(`(() => {
                startGame();
                const ing = ingredientAt(0, 0);
                placeChef(COLUMN_X[0] - ING_W / 2 - 6, 0);
                setChefInput(1, 0);
                for (let i = 0; i < 1800; i++) {
                    step(1 / 60);
                    if (!ingredients.some((i2) => i2.col === 0 && i2.falling) && ing.level > 0) break;
                }
                return ingredients.filter((i) => i.col === 0).map((i) => i.level).sort();
            })()`);
            expect(levels).toEqual([1, 2, 3, 4]);
        });

        test('dropping an ingredient scores points', async ({ page }) => {
            const s = await page.evaluate(`(() => {
                startGame();
                ingredients = ingredients.filter((i) => !(i.col === 0 && i.level > 0));
                const ing = ingredientAt(0, 0);
                placeChef(COLUMN_X[0] - ING_W / 2 - 6, 0);
                setChefInput(1, 0);
                for (let i = 0; i < 900 && (ing.level === 0 || ing.falling); i++) step(1 / 60);
                return { score, expected: POINTS_DROP };
            })()`);
            expect(s.score).toBe(s.expected);
            const hud = await page.locator('#score').textContent();
            expect(Number(hud)).toBe(s.score);
        });

        test('ingredients that reach the plate row stay there and stack up', async ({ page }) => {
            const s = await page.evaluate(() => {
                startGame();
                // Plate two ingredients in column 1 directly.
                const col = ingredients.filter((i) => i.col === 1).slice(0, 2);
                col.forEach((ing) => plateIngredient(ing));
                for (let i = 0; i < 60; i++) step(1 / 60);
                return {
                    plated: platedCount(1),
                    levels: col.map((i) => i.level),
                    ys: col.map((i) => i.y),
                };
            });
            expect(s.plated).toBe(2);
            expect(s.levels).toEqual([5, 5]);
            expect(s.ys[1]).toBeLessThan(s.ys[0]);
        });
    });

    // -----------------------------------------------------------------------
    // Burgers and level progression
    // -----------------------------------------------------------------------
    test.describe('burgers and levels', () => {
        test('a column is complete once all four of its ingredients are plated', async ({ page }) => {
            const s = await page.evaluate(() => {
                startGame();
                const before = columnComplete(2);
                ingredients.filter((i) => i.col === 2).forEach((ing) => plateIngredient(ing));
                return { before, after: columnComplete(2), plated: platedCount(2) };
            });
            expect(s.before).toBe(false);
            expect(s.after).toBe(true);
            expect(s.plated).toBe(4);
        });

        test('plating every burger clears the level and restocks the board', async ({ page }) => {
            const s = await page.evaluate(`(() => {
                startGame();
                ingredients.forEach((ing) => plateIngredient(ing));
                ${FRAMES(30)}
                return {
                    level,
                    total: ingredients.length,
                    plated: ingredients.filter((i) => i.level === PLATE_LEVEL).length,
                    state,
                };
            })()`);
            expect(s.level).toBe(2);
            expect(s.total).toBe(16);
            expect(s.plated).toBe(0);
            expect(s.state).toBe('running');
            await expect(page.locator('#level')).toHaveText('2');
        });

        test('clearing a level awards a bonus and refills the pepper shaker', async ({ page }) => {
            const s = await page.evaluate(`(() => {
                startGame();
                pepper = 1;
                const before = score;
                ingredients.forEach((ing) => plateIngredient(ing));
                ${FRAMES(30)}
                return { gained: score - before, pepper };
            })()`);
            expect(s.gained).toBeGreaterThan(0);
            expect(s.pepper).toBe(5);
        });

        test('later levels allow more enemies on screen', async ({ page }) => {
            const s = await page.evaluate(() => ({ l1: enemyCap(1), l3: enemyCap(3) }));
            expect(s.l3).toBeGreaterThan(s.l1);
        });

        test('later levels move enemies faster', async ({ page }) => {
            const s = await page.evaluate(() => ({ l1: enemySpeed(1), l4: enemySpeed(4) }));
            expect(s.l4).toBeGreaterThan(s.l1);
        });
    });

    // -----------------------------------------------------------------------
    // Enemies
    // -----------------------------------------------------------------------
    test.describe('enemies', () => {
        test('enemies appear over time once the game is running', async ({ page }) => {
            // Tracks the high-water mark: a spawned enemy may reach the chef and
            // be cleared by the life-lost reset before the window ends.
            const seen = await page.evaluate(`(() => {
                startGame();
                let seen = 0;
                for (let i = 0; i < 600; i++) { step(1 / 60); seen = Math.max(seen, enemies.length); }
                return seen;
            })()`);
            expect(seen).toBeGreaterThan(0);
        });

        test('the number of enemies never exceeds the level cap', async ({ page }) => {
            const s = await page.evaluate(`(() => {
                startGame();
                let max = 0;
                for (let i = 0; i < 3600; i++) { step(1 / 60); max = Math.max(max, enemies.length); }
                return { max, cap: enemyCap(level) };
            })()`);
            expect(s.max).toBeLessThanOrEqual(s.cap);
        });

        test('an enemy walks toward the chef on the same floor', async ({ page }) => {
            const s = await page.evaluate(`(() => {
                startGame();
                enemies.length = 0;
                placeChef(120, 5);
                const e = spawnEnemy({ x: 560, floor: 5 });
                const before = e.x;
                ${FRAMES(60)}
                return { before, after: e.x };
            })()`);
            expect(s.after).toBeLessThan(s.before);
        });

        test('an enemy climbs toward a chef on another floor', async ({ page }) => {
            const floor = await page.evaluate(`(() => {
                startGame();
                enemies.length = 0;
                placeChef(320, 3);
                const e = spawnEnemy({ x: 320, floor: 5 });
                ${FRAMES(600)}
                return e.floor;
            })()`);
            expect(floor).toBeLessThan(5);
        });

        test('touching an enemy costs a life and resets the actors', async ({ page }) => {
            const s = await page.evaluate(`(() => {
                startGame();
                enemies.length = 0;
                placeChef(320, 5);
                spawnEnemy({ x: 326, floor: 5 });
                ${FRAMES(5)}
                return { lives, enemies: enemies.length, state };
            })()`);
            expect(s.lives).toBe(2);
            expect(s.enemies).toBe(0);
            expect(s.state).toBe('running');
            await expect(page.locator('#lives')).toHaveText('2');
        });

        test('losing the last life ends the game and shows the overlay', async ({ page }) => {
            const s = await page.evaluate(`(() => {
                startGame();
                lives = 1;
                enemies.length = 0;
                placeChef(320, 5);
                spawnEnemy({ x: 326, floor: 5 });
                ${FRAMES(5)}
                return { state, lives };
            })()`);
            expect(s.state).toBe('over');
            expect(s.lives).toBe(0);
            await expect(page.locator('#overlay')).toHaveClass(/visible/);
            await expect(page.locator('#overlay-title')).toContainText(/over/i);
        });

        test('a falling ingredient squashes an enemy in its path', async ({ page }) => {
            const s = await page.evaluate(`(() => {
                startGame();
                enemies.length = 0;
                ingredients = ingredients.filter((i) => !(i.col === 0 && i.level > 0));
                spawnEnemy({ x: COLUMN_X[0], floor: 1 });
                const before = score;
                const ing = ingredientAt(0, 0);
                dropIngredient(ing);
                for (let i = 0; i < 300 && ing.falling; i++) step(1 / 60);
                ${FRAMES(10)}
                return { enemies: enemies.length, gained: score - before, lives };
            })()`);
            expect(s.enemies).toBe(0);
            expect(s.gained).toBeGreaterThanOrEqual(500);
            expect(s.lives).toBe(3);
        });

        test('an enemy off to the side is not squashed', async ({ page }) => {
            const s = await page.evaluate(`(() => {
                startGame();
                enemies.length = 0;
                ingredients = ingredients.filter((i) => !(i.col === 0 && i.level > 0));
                const e = spawnEnemy({ x: COLUMN_X[0] + ING_W, floor: 1 });
                e.stun = 5;
                const ing = ingredientAt(0, 0);
                dropIngredient(ing);
                for (let i = 0; i < 300 && ing.falling; i++) step(1 / 60);
                return { enemies: enemies.length, riding: !!e.rideBy };
            })()`);
            expect(s.enemies).toBe(1);
            expect(s.riding).toBe(false);
        });

        test('squashing two enemies with one ingredient scores a rising bonus', async ({ page }) => {
            const gained = await page.evaluate(`(() => {
                startGame();
                enemies.length = 0;
                ingredients = ingredients.filter((i) => !(i.col === 0 && i.level > 0));
                spawnEnemy({ x: COLUMN_X[0] - 10, floor: 1 });
                spawnEnemy({ x: COLUMN_X[0] + 10, floor: 1 });
                const before = score;
                const ing = ingredientAt(0, 0);
                dropIngredient(ing);
                for (let i = 0; i < 300 && ing.falling; i++) step(1 / 60);
                ${FRAMES(10)}
                return score - before;
            })()`);
            expect(gained).toBeGreaterThan(500 + 500);
        });

        test('a ridden enemy is carried down with the ingredient', async ({ page }) => {
            const s = await page.evaluate(`(() => {
                startGame();
                enemies.length = 0;
                ingredients = ingredients.filter((i) => !(i.col === 0 && i.level > 0));
                const e = spawnEnemy({ x: COLUMN_X[0], floor: 1 });
                const before = e.y;
                const ing = ingredientAt(0, 0);
                dropIngredient(ing);
                let riddenY = before;
                for (let i = 0; i < 300 && ing.falling; i++) {
                    step(1 / 60);
                    if (e.rideBy) riddenY = e.y;
                }
                return { before, riddenY };
            })()`);
            expect(s.riddenY).toBeGreaterThan(s.before);
        });
    });

    // -----------------------------------------------------------------------
    // Pepper
    // -----------------------------------------------------------------------
    test.describe('pepper', () => {
        test('spraying pepper stuns an enemy in front of the chef', async ({ page }) => {
            const s = await page.evaluate(`(() => {
                startGame();
                enemies.length = 0;
                placeChef(300, 5);
                setChefInput(1, 0);
                step(1 / 60);
                const e = spawnEnemy({ x: 340, floor: 5 });
                sprayPepper();
                return { stun: e.stun, pepper };
            })()`);
            expect(s.stun).toBeGreaterThan(0);
            expect(s.pepper).toBe(4);
            await expect(page.locator('#pepper')).toHaveText('4');
        });

        test('pepper does not reach behind the chef', async ({ page }) => {
            const stun = await page.evaluate(`(() => {
                startGame();
                enemies.length = 0;
                placeChef(300, 5);
                setChefInput(1, 0);
                step(1 / 60);
                const e = spawnEnemy({ x: 240, floor: 5 });
                sprayPepper();
                return e.stun;
            })()`);
            expect(stun).toBe(0);
        });

        test('a stunned enemy does not move', async ({ page }) => {
            const s = await page.evaluate(`(() => {
                startGame();
                enemies.length = 0;
                placeChef(120, 5);
                const e = spawnEnemy({ x: 400, floor: 5 });
                e.stun = 3;
                const before = e.x;
                ${FRAMES(60)}
                return { before, after: e.x, stun: e.stun };
            })()`);
            expect(s.after).toBe(s.before);
            expect(s.stun).toBeLessThan(3);
        });

        test('a stunned enemy recovers and does not hurt the chef while stunned', async ({ page }) => {
            const s = await page.evaluate(`(() => {
                startGame();
                enemies.length = 0;
                placeChef(320, 5);
                const e = spawnEnemy({ x: 326, floor: 5 });
                e.stun = 0.5;
                ${FRAMES(5)}
                const lifeWhileStunned = lives;
                ${FRAMES(120)}
                return { lifeWhileStunned, lives };
            })()`);
            expect(s.lifeWhileStunned).toBe(3);
            expect(s.lives).toBe(2);
        });

        test('pepper cannot be thrown when the shaker is empty', async ({ page }) => {
            const s = await page.evaluate(() => {
                startGame();
                pepper = 0;
                enemies.length = 0;
                placeChef(300, 5);
                const e = spawnEnemy({ x: 330, floor: 5 });
                const thrown = sprayPepper();
                return { thrown, stun: e.stun, pepper };
            });
            expect(s.thrown).toBe(false);
            expect(s.stun).toBe(0);
            expect(s.pepper).toBe(0);
        });

        test('Space throws pepper while the game is running', async ({ page }) => {
            await page.evaluate(() => { startGame(); });
            await page.keyboard.press('Space');
            expect(await page.evaluate(() => pepper)).toBe(4);
        });
    });

    // -----------------------------------------------------------------------
    // Pause, game over and restart
    // -----------------------------------------------------------------------
    test.describe('pause and restart', () => {
        test('P pauses and resumes the game', async ({ page }) => {
            await page.evaluate(() => { startGame(); });
            await page.keyboard.press('p');
            expect(await page.evaluate(() => state)).toBe('paused');
            await page.keyboard.press('p');
            expect(await page.evaluate(() => state)).toBe('running');
        });

        test('nothing moves while paused', async ({ page }) => {
            const s = await page.evaluate(`(() => {
                startGame();
                placeChef(320, 5);
                setChefInput(1, 0);
                togglePause();
                const before = chef.x;
                ${FRAMES(60)}
                return { before, after: chef.x };
            })()`);
            expect(s.after).toBe(s.before);
        });

        test('the pause overlay is visible while paused', async ({ page }) => {
            await page.evaluate(() => { startGame(); togglePause(); });
            await expect(page.locator('#overlay')).toHaveClass(/visible/);
            await expect(page.locator('#overlay-title')).toContainText(/paus/i);
        });

        test('game over records a new best score', async ({ page }) => {
            const best = await page.evaluate(`(() => {
                startGame();
                score = 7350;
                lives = 1;
                enemies.length = 0;
                placeChef(320, 5);
                spawnEnemy({ x: 326, floor: 5 });
                ${FRAMES(5)}
                return localStorage.getItem('burgertime-best');
            })()`);
            expect(best).toBe('7350');
            await expect(page.locator('#best')).toHaveText('7350');
        });

        test('restarting after game over resets the board', async ({ page }) => {
            const s = await page.evaluate(`(() => {
                startGame();
                score = 900;
                lives = 1;
                enemies.length = 0;
                placeChef(320, 5);
                spawnEnemy({ x: 326, floor: 5 });
                ${FRAMES(5)}
                startGame();
                return { state, score, lives, level, ingredients: ingredients.length };
            })()`);
            expect(s).toEqual({ state: 'running', score: 0, lives: 3, level: 1, ingredients: 16 });
        });

        test('the game renders without throwing script errors', async ({ page }) => {
            const errors = [];
            page.on('pageerror', (err) => errors.push(err.message));
            await page.reload();
            await page.evaluate(`(() => {
                startGame();
                setChefInput(1, 0);
                ${FRAMES(300)}
                setChefInput(0, -1);
                ${FRAMES(300)}
                sprayPepper();
                ${FRAMES(120)}
            })()`);
            await page.waitForTimeout(200);
            expect(errors).toEqual([]);
        });
    });
});
