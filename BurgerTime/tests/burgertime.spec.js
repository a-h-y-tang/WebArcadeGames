const { test, expect } = require('@playwright/test');
const path = require('path');
const { pathToFileURL } = require('url');

const GAME_URL = pathToFileURL(path.resolve(__dirname, '../index.html')).href;

// Advance the simulation by `frames` fixed 1/60s steps inside the page.
const advance = (page, frames) =>
    page.evaluate((n) => { for (let i = 0; i < n; i++) step(1 / 60); }, frames);

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

        test('canvas is 600x480', async ({ page }) => {
            const canvas = page.locator('#canvas');
            await expect(canvas).toHaveAttribute('width', '600');
            await expect(canvas).toHaveAttribute('height', '480');
        });

        test('state is idle before starting', async ({ page }) => {
            expect(await page.evaluate(() => state)).toBe('idle');
        });

        test('HUD starts at zero score, level 1, 3 lives, 5 peppers', async ({ page }) => {
            await expect(page.locator('#score')).toHaveText('0');
            await expect(page.locator('#level')).toHaveText('1');
            await expect(page.locator('#lives')).toHaveText('3');
            await expect(page.locator('#peppers')).toHaveText('5');
            await expect(page.locator('#best')).toHaveText('0');
        });

        test('best score loads from localStorage', async ({ page }) => {
            await page.evaluate(() => window.localStorage.setItem('burgertime-best', '4200'));
            await page.reload();
            await expect(page.locator('#best')).toHaveText('4200');
        });

        test('stepping while idle does nothing', async ({ page }) => {
            await advance(page, 60);
            expect(await page.evaluate(() => state)).toBe('idle');
        });
    });

    // -----------------------------------------------------------------------
    // Board layout
    // -----------------------------------------------------------------------
    test.describe('board layout', () => {
        test.beforeEach(async ({ page }) => { await page.evaluate(() => startGame()); });

        test('has five floors at the documented heights', async ({ page }) => {
            const ys = await page.evaluate(() => FLOOR_ROWS.map((_, i) => floorY(i)));
            expect(ys).toEqual([40, 120, 200, 280, 360]);
        });

        test('has three ladders in the gaps between burger shafts', async ({ page }) => {
            expect(await page.evaluate(() => ladderXs)).toEqual([140, 300, 460]);
        });

        test('has four burger shafts', async ({ page }) => {
            const xs = await page.evaluate(() => STACK_COLS.map((_, s) => stackLeftX(s)));
            expect(xs).toEqual([0, 160, 320, 480]);
        });

        test('no ladder overlaps a burger shaft', async ({ page }) => {
            const clear = await page.evaluate(() =>
                ladderXs.every((lx) =>
                    STACK_COLS.every((_, s) => lx < stackLeftX(s) || lx > stackLeftX(s) + 3 * TILE)));
            expect(clear).toBe(true);
        });

        test('builds 16 ingredients — four shafts of four', async ({ page }) => {
            expect(await page.evaluate(() => ingredients.length)).toBe(16);
            const perStack = await page.evaluate(() =>
                STACK_COLS.map((_, s) => ingredients.filter((i) => i.stack === s).length));
            expect(perStack).toEqual([4, 4, 4, 4]);
        });

        test('each shaft is stacked bun / lettuce / patty / bun top to bottom', async ({ page }) => {
            const types = await page.evaluate(() => [0, 1, 2, 3].map((f) => ingredientAt(f, 0).type));
            expect(types).toEqual(['bunTop', 'lettuce', 'patty', 'bunBottom']);
        });

        test('ingredients start resting on their floor with no segments pressed', async ({ page }) => {
            const ok = await page.evaluate(() => ingredients.every((i) =>
                !i.falling && !i.onPlate && i.y === floorY(i.floor) && i.segments.every((p) => !p)));
            expect(ok).toBe(true);
        });

        test('all plates start empty', async ({ page }) => {
            expect(await page.evaluate(() => plates.map((p) => p.length))).toEqual([0, 0, 0, 0]);
        });
    });

    // -----------------------------------------------------------------------
    // Starting / pausing
    // -----------------------------------------------------------------------
    test.describe('starting and pausing', () => {
        test('Space starts the game', async ({ page }) => {
            await page.keyboard.press('Space');
            expect(await page.evaluate(() => state)).toBe('running');
        });

        test('Enter starts the game', async ({ page }) => {
            await page.keyboard.press('Enter');
            expect(await page.evaluate(() => state)).toBe('running');
        });

        test('the Start button starts the game', async ({ page }) => {
            await page.locator('#btn-start').click();
            expect(await page.evaluate(() => state)).toBe('running');
        });

        test('starting hides the overlay', async ({ page }) => {
            await page.evaluate(() => startGame());
            await expect(page.locator('#overlay')).not.toHaveClass(/visible/);
        });

        test('chef spawns on the bottom floor', async ({ page }) => {
            await page.evaluate(() => startGame());
            const spawn = await page.evaluate(() => ({ x: chef.x, y: chef.y }));
            expect(spawn.y).toBe(360);
            expect(spawn.x).toBe(300);
        });

        test('P pauses and resumes', async ({ page }) => {
            await page.evaluate(() => startGame());
            await page.keyboard.press('KeyP');
            expect(await page.evaluate(() => state)).toBe('paused');
            await page.keyboard.press('KeyP');
            expect(await page.evaluate(() => state)).toBe('running');
        });

        test('a paused game does not advance', async ({ page }) => {
            await page.evaluate(() => { startGame(); setInput('right', true); });
            await page.keyboard.press('KeyP');
            const before = await page.evaluate(() => chef.x);
            await advance(page, 60);
            expect(await page.evaluate(() => chef.x)).toBe(before);
        });
    });

    // -----------------------------------------------------------------------
    // Chef movement
    // -----------------------------------------------------------------------
    test.describe('chef movement', () => {
        // Movement is tested in isolation: no enemies, so a long walk can never
        // be cut short by losing a life.
        test.beforeEach(async ({ page }) => {
            await page.evaluate(() => { startGame(); enemies.length = 0; chef.invuln = 999; });
        });

        test('walks right along a floor', async ({ page }) => {
            const before = await page.evaluate(() => chef.x);
            await page.evaluate(() => setInput('right', true));
            await advance(page, 60);
            const after = await page.evaluate(() => chef.x);
            expect(after - before).toBeGreaterThan(80);
            expect(after - before).toBeLessThan(140);
        });

        test('walks left along a floor', async ({ page }) => {
            const before = await page.evaluate(() => chef.x);
            await page.evaluate(() => setInput('left', true));
            await advance(page, 60);
            expect(await page.evaluate(() => chef.x)).toBeLessThan(before);
        });

        test('faces the direction of travel', async ({ page }) => {
            await page.evaluate(() => setInput('left', true));
            await advance(page, 5);
            expect(await page.evaluate(() => chef.dir)).toBe(-1);
            await page.evaluate(() => { setInput('left', false); setInput('right', true); });
            await advance(page, 5);
            expect(await page.evaluate(() => chef.dir)).toBe(1);
        });

        test('cannot walk off the right edge', async ({ page }) => {
            await page.evaluate(() => setInput('right', true));
            await advance(page, 600);
            expect(await page.evaluate(() => chef.x)).toBeLessThanOrEqual(600);
            expect(await page.evaluate(() => chef.x)).toBeGreaterThan(560);
        });

        test('cannot walk off the left edge', async ({ page }) => {
            await page.evaluate(() => setInput('left', true));
            await advance(page, 600);
            expect(await page.evaluate(() => chef.x)).toBeGreaterThanOrEqual(0);
            expect(await page.evaluate(() => chef.x)).toBeLessThan(40);
        });

        test('climbs up a ladder', async ({ page }) => {
            await page.evaluate(() => setInput('up', true));
            await advance(page, 60);
            expect(await page.evaluate(() => chef.y)).toBeLessThan(300);
        });

        test('climbing snaps the chef onto the ladder centre', async ({ page }) => {
            await page.evaluate(() => { chef.x = 292; setInput('up', true); });
            await advance(page, 10);
            expect(await page.evaluate(() => chef.x)).toBe(300);
        });

        test('cannot climb away from a ladder', async ({ page }) => {
            await page.evaluate(() => { chef.x = 200; setInput('up', true); });
            await advance(page, 60);
            expect(await page.evaluate(() => chef.y)).toBe(360);
        });

        test('cannot climb above the top floor', async ({ page }) => {
            await page.evaluate(() => setInput('up', true));
            await advance(page, 600);
            expect(await page.evaluate(() => chef.y)).toBe(40);
        });

        test('cannot climb below the bottom floor', async ({ page }) => {
            await page.evaluate(() => setInput('down', true));
            await advance(page, 600);
            expect(await page.evaluate(() => chef.y)).toBe(360);
        });

        test('cannot walk horizontally while mid-ladder', async ({ page }) => {
            // One evaluate so the real animation frame loop cannot creep the
            // chef up the ladder between the "before" and "after" readings.
            const r = await page.evaluate(() => {
                setInput('up', true);
                for (let i = 0; i < 20; i++) step(1 / 60);
                setInput('up', false);
                const midY = chef.y;
                const midFloor = floorIndexAtY(chef.y);
                setInput('right', true);
                for (let i = 0; i < 30; i++) step(1 / 60);
                return { x: chef.x, y: chef.y, midY, midFloor };
            });
            expect(r.midFloor).toBeNull();
            expect(r.x).toBe(300);
            expect(r.y).toBe(r.midY);
        });

        test('climbing all the way up reaches the top floor exactly', async ({ page }) => {
            await page.evaluate(() => setInput('up', true));
            await advance(page, 200);
            expect(await page.evaluate(() => floorIndexAtY(chef.y))).toBe(0);
        });
    });

    // -----------------------------------------------------------------------
    // Pressing and dropping ingredients
    // -----------------------------------------------------------------------
    test.describe('dropping ingredients', () => {
        test.beforeEach(async ({ page }) => {
            await page.evaluate(() => { startGame(); enemies.length = 0; chef.invuln = 999; });
        });

        test('standing on a segment presses it', async ({ page }) => {
            const segs = await page.evaluate(() => {
                chef.y = floorY(3); chef.x = 20;
                step(1 / 60);
                return ingredientAt(3, 0).segments.slice();
            });
            expect(segs).toEqual([true, false, false]);
        });

        test('walking the whole ingredient drops it', async ({ page }) => {
            const falling = await page.evaluate(() => {
                const ing = ingredientAt(3, 0);
                chef.y = floorY(3);
                for (const x of [20, 60, 100]) { chef.x = x; step(1 / 60); }
                return ing.falling;
            });
            expect(falling).toBe(true);
        });

        test('two of three segments is not enough', async ({ page }) => {
            const falling = await page.evaluate(() => {
                const ing = ingredientAt(3, 0);
                chef.y = floorY(3);
                for (const x of [20, 60]) { chef.x = x; step(1 / 60); }
                return ing.falling;
            });
            expect(falling).toBe(false);
        });

        test('standing on a different floor presses nothing', async ({ page }) => {
            const pressed = await page.evaluate(() => {
                chef.y = floorY(4); chef.x = 20;
                step(1 / 60);
                return ingredients.some((i) => i.segments.some((p) => p));
            });
            expect(pressed).toBe(false);
        });

        test('dropping an ingredient scores 50', async ({ page }) => {
            await page.evaluate(() => dropIngredient(ingredientAt(3, 0)));
            await expect(page.locator('#score')).toHaveText('50');
        });

        test('dropping an already-falling ingredient is a no-op', async ({ page }) => {
            const score = await page.evaluate(() => {
                const ing = ingredientAt(3, 0);
                dropIngredient(ing);
                dropIngredient(ing);
                return score;
            });
            expect(score).toBe(50);
        });

        test('a dropped ingredient falls', async ({ page }) => {
            await page.evaluate(() => dropIngredient(ingredientAt(3, 0)));
            await advance(page, 10);
            expect(await page.evaluate(() => ingredientAt(3, 0).y)).toBeGreaterThan(280);
        });

        test('a dropped ingredient lands on its plate', async ({ page }) => {
            await page.evaluate(() => dropIngredient(ingredientAt(3, 0)));
            await advance(page, 120);
            const ing = await page.evaluate(() => {
                const i = ingredients.find((x) => x.stack === 0 && x.type === 'bunBottom');
                return { onPlate: i.onPlate, falling: i.falling, y: i.y };
            });
            expect(ing.onPlate).toBe(true);
            expect(ing.falling).toBe(false);
            expect(ing.y).toBe(440);
            expect(await page.evaluate(() => plates[0].length)).toBe(1);
        });

        test('only the dropped shaft is affected', async ({ page }) => {
            await page.evaluate(() => dropIngredient(ingredientAt(3, 0)));
            await advance(page, 120);
            expect(await page.evaluate(() => plates.map((p) => p.length))).toEqual([1, 0, 0, 0]);
        });
    });

    // -----------------------------------------------------------------------
    // Cascades
    // -----------------------------------------------------------------------
    test.describe('cascading', () => {
        test.beforeEach(async ({ page }) => {
            await page.evaluate(() => { startGame(); enemies.length = 0; chef.invuln = 999; });
        });

        test('a falling ingredient knocks loose the ones below it', async ({ page }) => {
            await page.evaluate(() => dropIngredient(ingredientAt(0, 0)));
            await advance(page, 200);
            expect(await page.evaluate(() => plates[0].length)).toBe(4);
        });

        test('a cascade builds the burger in the right order', async ({ page }) => {
            await page.evaluate(() => dropIngredient(ingredientAt(0, 0)));
            await advance(page, 200);
            const order = await page.evaluate(() => plates[0].map((i) => i.type));
            expect(order).toEqual(['bunBottom', 'patty', 'lettuce', 'bunTop']);
        });

        test('plated ingredients are stacked upward from the plate', async ({ page }) => {
            await page.evaluate(() => dropIngredient(ingredientAt(0, 0)));
            await advance(page, 200);
            const ys = await page.evaluate(() => plates[0].map((i) => i.y));
            expect(ys).toEqual([440, 430, 420, 410]);
        });

        test('a full cascade scores 50 per ingredient', async ({ page }) => {
            await page.evaluate(() => dropIngredient(ingredientAt(0, 0)));
            await advance(page, 200);
            expect(await page.evaluate(() => score)).toBe(200);
        });

        test('dropping the bottom bun leaves the pieces above it alone', async ({ page }) => {
            await page.evaluate(() => dropIngredient(ingredientAt(3, 0)));
            await advance(page, 200);
            const resting = await page.evaluate(() =>
                ingredients.filter((i) => i.stack === 0 && !i.onPlate).length);
            expect(resting).toBe(3);
        });
    });

    // -----------------------------------------------------------------------
    // Enemies
    // -----------------------------------------------------------------------
    test.describe('enemies', () => {
        test.beforeEach(async ({ page }) => { await page.evaluate(() => startGame()); });

        test('level 1 fields two enemies', async ({ page }) => {
            expect(await page.evaluate(() => enemies.length)).toBe(2);
        });

        test('enemies spawn on the top floor', async ({ page }) => {
            const ys = await page.evaluate(() => enemies.map((e) => e.y));
            expect(ys.every((y) => y === 40)).toBe(true);
        });

        test('an enemy moves toward the chef', async ({ page }) => {
            const closed = await page.evaluate(() => {
                enemies.length = 1;
                chef.invuln = 999;
                const before = Math.abs(enemies[0].x - chef.x) + Math.abs(enemies[0].y - chef.y);
                for (let i = 0; i < 120; i++) step(1 / 60);
                const after = Math.abs(enemies[0].x - chef.x) + Math.abs(enemies[0].y - chef.y);
                return before - after;
            });
            expect(closed).toBeGreaterThan(0);
        });

        test('an enemy descends toward a chef on a lower floor', async ({ page }) => {
            await page.evaluate(() => { enemies.length = 1; chef.invuln = 999; });
            await advance(page, 300);
            expect(await page.evaluate(() => enemies[0].y)).toBeGreaterThan(40);
        });

        test('a falling ingredient squashes an enemy', async ({ page }) => {
            await page.evaluate(() => {
                chef.invuln = 999;
                enemies.length = 1;
                enemies[0].x = 60;
                enemies[0].y = floorY(3);
                dropIngredient(ingredientAt(3, 0));
            });
            await advance(page, 2);
            expect(await page.evaluate(() => enemies[0].squashed)).toBe(true);
        });

        test('squashing an enemy scores 100', async ({ page }) => {
            await page.evaluate(() => {
                chef.invuln = 999;
                enemies.length = 1;
                enemies[0].x = 60;
                enemies[0].y = floorY(3);
                dropIngredient(ingredientAt(3, 0));
            });
            await advance(page, 2);
            expect(await page.evaluate(() => score)).toBe(150);
        });

        test('a squashed enemy respawns', async ({ page }) => {
            await page.evaluate(() => {
                chef.invuln = 999;
                enemies.length = 1;
                enemies[0].x = 60;
                enemies[0].y = floorY(3);
                dropIngredient(ingredientAt(3, 0));
            });
            await advance(page, 2);
            expect(await page.evaluate(() => enemies[0].squashed)).toBe(true);
            await advance(page, 300);
            expect(await page.evaluate(() => enemies[0].squashed)).toBe(false);
            expect(await page.evaluate(() => enemies[0].y)).toBe(40);
        });

        test('a squashed enemy does not move or hurt the chef', async ({ page }) => {
            const lives = await page.evaluate(() => {
                enemies.length = 1;
                enemies[0].x = 60;
                enemies[0].y = floorY(3);
                dropIngredient(ingredientAt(3, 0));
                for (let i = 0; i < 2; i++) step(1 / 60);
                chef.invuln = 0;
                chef.x = enemies[0].x;
                chef.y = enemies[0].y;
                step(1 / 60);
                return lives;
            });
            expect(lives).toBe(3);
        });

        test('enemies are faster on later levels', async ({ page }) => {
            const [one, three] = await page.evaluate(() => {
                const a = enemySpeed();
                level = 3;
                return [a, enemySpeed()];
            });
            expect(three).toBeGreaterThan(one);
        });

        test('later levels field more enemies', async ({ page }) => {
            const n = await page.evaluate(() => { level = 4; spawnEnemies(); return enemies.length; });
            expect(n).toBe(5);
        });
    });

    // -----------------------------------------------------------------------
    // Pepper
    // -----------------------------------------------------------------------
    test.describe('pepper', () => {
        test.beforeEach(async ({ page }) => { await page.evaluate(() => startGame()); });

        test('spraying uses a pepper', async ({ page }) => {
            await page.evaluate(() => spray());
            expect(await page.evaluate(() => peppers)).toBe(4);
            await expect(page.locator('#peppers')).toHaveText('4');
        });

        test('spraying makes a cloud', async ({ page }) => {
            await page.evaluate(() => spray());
            expect(await page.evaluate(() => clouds.length)).toBe(1);
        });

        test('a cloud stuns an enemy in front of the chef', async ({ page }) => {
            const stunned = await page.evaluate(() => {
                chef.invuln = 999;
                enemies.length = 1;
                enemies[0].x = chef.x + 28;
                enemies[0].y = chef.y;
                chef.dir = 1;
                spray();
                step(1 / 60);
                return enemies[0].stunned;
            });
            expect(stunned).toBeGreaterThan(0);
        });

        test('a cloud does not reach behind the chef', async ({ page }) => {
            const stunned = await page.evaluate(() => {
                chef.invuln = 999;
                enemies.length = 1;
                enemies[0].x = chef.x - 28;
                enemies[0].y = chef.y;
                chef.dir = 1;
                spray();
                step(1 / 60);
                return enemies[0].stunned;
            });
            expect(stunned).toBe(0);
        });

        test('a stunned enemy stops moving', async ({ page }) => {
            const moved = await page.evaluate(() => {
                chef.invuln = 999;
                enemies.length = 1;
                enemies[0].x = chef.x + 28;
                enemies[0].y = chef.y;
                chef.dir = 1;
                spray();
                step(1 / 60);
                const before = enemies[0].x;
                for (let i = 0; i < 60; i++) step(1 / 60);
                return Math.abs(enemies[0].x - before);
            });
            expect(moved).toBe(0);
        });

        test('a stunned enemy is harmless', async ({ page }) => {
            const lives = await page.evaluate(() => {
                enemies.length = 1;
                enemies[0].x = chef.x + 28;
                enemies[0].y = chef.y;
                chef.dir = 1;
                spray();
                step(1 / 60);
                chef.invuln = 0;
                chef.x = enemies[0].x;
                step(1 / 60);
                return lives;
            });
            expect(lives).toBe(3);
        });

        test('the stun wears off', async ({ page }) => {
            await page.evaluate(() => {
                chef.invuln = 999;
                enemies.length = 1;
                enemies[0].x = chef.x + 28;
                enemies[0].y = chef.y;
                chef.dir = 1;
                spray();
            });
            await advance(page, 300);
            expect(await page.evaluate(() => enemies[0].stunned)).toBe(0);
        });

        test('the cloud fades', async ({ page }) => {
            await page.evaluate(() => spray());
            await advance(page, 120);
            expect(await page.evaluate(() => clouds.length)).toBe(0);
        });

        test('cannot spray without pepper', async ({ page }) => {
            const after = await page.evaluate(() => {
                peppers = 0;
                spray();
                return { peppers, clouds: clouds.length };
            });
            expect(after.peppers).toBe(0);
            expect(after.clouds).toBe(0);
        });

        test('Space sprays while running', async ({ page }) => {
            await page.keyboard.press('Space');
            expect(await page.evaluate(() => peppers)).toBe(4);
        });
    });

    // -----------------------------------------------------------------------
    // Lives and game over
    // -----------------------------------------------------------------------
    test.describe('lives', () => {
        test.beforeEach(async ({ page }) => { await page.evaluate(() => startGame()); });

        const collide = (page) => page.evaluate(() => {
            chef.invuln = 0;
            enemies[0].x = chef.x;
            enemies[0].y = chef.y;
            step(1 / 60);
        });

        test('touching an enemy costs a life', async ({ page }) => {
            await collide(page);
            expect(await page.evaluate(() => lives)).toBe(2);
            await expect(page.locator('#lives')).toHaveText('2');
        });

        test('losing a life returns the chef to the spawn point', async ({ page }) => {
            await page.evaluate(() => { chef.x = 100; chef.y = floorY(1); });
            await collide(page);
            expect(await page.evaluate(() => ({ x: chef.x, y: chef.y }))).toEqual({ x: 300, y: 360 });
        });

        test('losing a life grants brief invulnerability', async ({ page }) => {
            await collide(page);
            expect(await page.evaluate(() => chef.invuln)).toBeGreaterThan(0);
        });

        test('the chef cannot be hit twice while invulnerable', async ({ page }) => {
            await collide(page);
            await page.evaluate(() => {
                enemies[0].x = chef.x;
                enemies[0].y = chef.y;
                step(1 / 60);
            });
            expect(await page.evaluate(() => lives)).toBe(2);
        });

        test('losing a life keeps burger progress', async ({ page }) => {
            await page.evaluate(() => { chef.invuln = 999; dropIngredient(ingredientAt(3, 0)); });
            await advance(page, 120);
            await collide(page);
            expect(await page.evaluate(() => plates[0].length)).toBe(1);
        });

        test('losing the last life ends the game', async ({ page }) => {
            await page.evaluate(() => { lives = 1; });
            await collide(page);
            expect(await page.evaluate(() => state)).toBe('over');
            await expect(page.locator('#overlay')).toHaveClass(/visible/);
            await expect(page.locator('#overlay-title')).toContainText(/over/i);
        });

        test('the game over screen reports the score', async ({ page }) => {
            await page.evaluate(() => { chef.invuln = 999; dropIngredient(ingredientAt(3, 0)); lives = 1; });
            await collide(page);
            await expect(page.locator('#overlay-score')).toContainText('50');
        });

        test('game over records a new best score', async ({ page }) => {
            await page.evaluate(() => { chef.invuln = 999; dropIngredient(ingredientAt(3, 0)); lives = 1; });
            await collide(page);
            await expect(page.locator('#best')).toHaveText('50');
            expect(await page.evaluate(() => window.localStorage.getItem('burgertime-best'))).toBe('50');
        });

        test('a finished game does not advance', async ({ page }) => {
            await page.evaluate(() => { lives = 1; });
            await collide(page);
            const x = await page.evaluate(() => { setInput('right', true); return chef.x; });
            await advance(page, 60);
            expect(await page.evaluate(() => chef.x)).toBe(x);
        });

        test('Space restarts after a game over', async ({ page }) => {
            await page.evaluate(() => { lives = 1; });
            await collide(page);
            await page.keyboard.press('Space');
            expect(await page.evaluate(() => ({ state, lives, score }))).toEqual({
                state: 'running', lives: 3, score: 0,
            });
        });
    });

    // -----------------------------------------------------------------------
    // Levels
    // -----------------------------------------------------------------------
    test.describe('levels', () => {
        const clearBoard = (page) => page.evaluate(() => {
            startGame();
            enemies.length = 0;
            chef.invuln = 999;
            ingredients.forEach((i) => dropIngredient(i));
        });

        test('plating every ingredient clears the level', async ({ page }) => {
            await clearBoard(page);
            await advance(page, 150);
            expect(await page.evaluate(() => plates.map((p) => p.length))).toEqual([4, 4, 4, 4]);
            expect(await page.evaluate(() => state)).toBe('levelclear');
        });

        test('clearing a level shows a banner', async ({ page }) => {
            await clearBoard(page);
            await advance(page, 150);
            await expect(page.locator('#overlay')).toHaveClass(/visible/);
            await expect(page.locator('#overlay-title')).toContainText(/level/i);
        });

        test('clearing a level awards the bonus', async ({ page }) => {
            await clearBoard(page);
            await advance(page, 150);
            expect(await page.evaluate(() => score)).toBe(16 * 50 + 1000);
        });

        test('the next level rebuilds the board', async ({ page }) => {
            await clearBoard(page);
            await advance(page, 300);
            expect(await page.evaluate(() => level)).toBe(2);
            expect(await page.evaluate(() => state)).toBe('running');
            expect(await page.evaluate(() => ingredients.length)).toBe(16);
            expect(await page.evaluate(() => plates.map((p) => p.length))).toEqual([0, 0, 0, 0]);
            await expect(page.locator('#level')).toHaveText('2');
        });

        test('the next level restocks a pepper', async ({ page }) => {
            await clearBoard(page);
            await advance(page, 300);
            expect(await page.evaluate(() => peppers)).toBe(6);
        });

        test('the next level keeps the score', async ({ page }) => {
            await clearBoard(page);
            await advance(page, 300);
            expect(await page.evaluate(() => score)).toBe(16 * 50 + 1000);
        });

        test('restarting resets the level', async ({ page }) => {
            await clearBoard(page);
            await advance(page, 300);
            await page.evaluate(() => startGame());
            expect(await page.evaluate(() => ({ level, score, peppers }))).toEqual({
                level: 1, score: 0, peppers: 5,
            });
        });
    });
});
