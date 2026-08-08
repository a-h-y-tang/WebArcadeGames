const { test, expect } = require('@playwright/test');
const path = require('path');
const { pathToFileURL } = require('url');

const GAME_URL = pathToFileURL(path.resolve(__dirname, '../index.html')).href;

// Most gameplay tests want a board with no enemies wandering into the scenario,
// so they clear the roster and push the spawn timer out of reach first with
// `enemies.length = 0; spawnTimer = 999;`.

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

        test('hud starts at zero score, 3 lives, level 1, 5 pepper', async ({ page }) => {
            await expect(page.locator('#score')).toHaveText('0');
            await expect(page.locator('#best')).toHaveText('0');
            await expect(page.locator('#lives')).toHaveText('3');
            await expect(page.locator('#level')).toHaveText('1');
            await expect(page.locator('#pepper')).toHaveText('5');
        });

        test('canvas matches the tile grid', async ({ page }) => {
            const { w, h } = await page.evaluate(() => ({ w: COLS * TILE, h: ROWS * TILE }));
            const canvas = page.locator('#canvas');
            await expect(canvas).toHaveAttribute('width', String(w));
            await expect(canvas).toHaveAttribute('height', String(h));
        });

        test('state is idle before starting', async ({ page }) => {
            expect(await page.evaluate(() => state)).toBe('idle');
        });

        test('no enemies before starting', async ({ page }) => {
            expect(await page.evaluate(() => enemies.length)).toBe(0);
        });

        test('the board is already laid out on the idle screen', async ({ page }) => {
            expect(await page.evaluate(() => ingredients.length)).toBe(16);
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

        test('starting resets score, lives, level and pepper', async ({ page }) => {
            const s = await page.evaluate(() => {
                startGame();
                return { score, lives, level, pepper };
            });
            expect(s).toEqual({ score: 0, lives: 3, level: 1, pepper: 5 });
        });

        test('four lanes of four ingredients each', async ({ page }) => {
            const perLane = await page.evaluate(() => {
                startGame();
                return LANES.map((_, lane) => ingredients.filter((i) => i.lane === lane).length);
            });
            expect(perLane).toEqual([4, 4, 4, 4]);
        });

        test('ingredients start on the upper four floors', async ({ page }) => {
            const rows = await page.evaluate(() => {
                startGame();
                return [...new Set(ingredients.map((i) => i.row))].sort((a, b) => a - b);
            });
            expect(rows).toEqual([1, 4, 7, 10]);
        });

        test('nothing is on a plate at the start', async ({ page }) => {
            const plated = await page.evaluate(() => {
                startGame();
                return ingredients.filter((i) => i.onPlate).length;
            });
            expect(plated).toBe(0);
        });

        test('the chef starts on the bottom floor', async ({ page }) => {
            const onPlateRow = await page.evaluate(() => {
                startGame();
                return chef.y === floorY(PLATE_ROW);
            });
            expect(onPlateRow).toBe(true);
        });
    });

    // -----------------------------------------------------------------------
    // Board geometry
    // -----------------------------------------------------------------------
    test.describe('geometry', () => {
        test('floorY maps a row to its pixel line', async ({ page }) => {
            const ok = await page.evaluate(() => FLOOR_ROWS.every((r) => floorY(r) === r * TILE));
            expect(ok).toBe(true);
        });

        test('floorRowAt finds a floor at its exact line', async ({ page }) => {
            const rows = await page.evaluate(() => FLOOR_ROWS.map((r) => floorRowAt(floorY(r))));
            expect(rows).toEqual([1, 4, 7, 10, 13]);
        });

        test('floorRowAt returns null between floors', async ({ page }) => {
            const r = await page.evaluate(() => floorRowAt(floorY(1) + TILE * 1.5));
            expect(r).toBeNull();
        });

        test('the four main ladders run the full height', async ({ page }) => {
            const ok = await page.evaluate(() =>
                [0, 4, 8, 12].every((col) => isLadder(col, 1) && isLadder(col, 7) && isLadder(col, 13)),
            );
            expect(ok).toBe(true);
        });

        test('a column with no ladder reports none', async ({ page }) => {
            expect(await page.evaluate(() => isLadder(3, 7))).toBe(false);
        });

        test('partial ladders only cover their own span', async ({ page }) => {
            const r = await page.evaluate(() => ({ inside: isLadder(2, 5), outside: isLadder(2, 12) }));
            expect(r).toEqual({ inside: true, outside: false });
        });

        test('every lane fits inside the canvas', async ({ page }) => {
            const ok = await page.evaluate(() =>
                LANES.every((left) => left >= 0 && (left + LANE_TILES) * TILE <= COLS * TILE),
            );
            expect(ok).toBe(true);
        });

        test('nextFloorRowBelow walks down the floors and stops at the plate', async ({ page }) => {
            const r = await page.evaluate(() => [1, 4, 7, 10, 13].map(nextFloorRowBelow));
            expect(r).toEqual([4, 7, 10, 13, 13]);
        });
    });

    // -----------------------------------------------------------------------
    // Chef movement
    // -----------------------------------------------------------------------
    test.describe('chef movement', () => {
        test('walking right increases x', async ({ page }) => {
            const moved = await page.evaluate(() => {
                startGame();
                enemies.length = 0; spawnTimer = 999;
                setChefTile(8, 13);
                const before = chef.x;
                moveChef(1, 0);
                for (let i = 0; i < 30; i++) step(0.016);
                return chef.x > before;
            });
            expect(moved).toBe(true);
        });

        test('walking left decreases x', async ({ page }) => {
            const moved = await page.evaluate(() => {
                startGame();
                enemies.length = 0; spawnTimer = 999;
                setChefTile(8, 13);
                const before = chef.x;
                moveChef(-1, 0);
                for (let i = 0; i < 30; i++) step(0.016);
                return chef.x < before;
            });
            expect(moved).toBe(true);
        });

        test('the chef cannot walk off the left edge', async ({ page }) => {
            const x = await page.evaluate(() => {
                startGame();
                enemies.length = 0; spawnTimer = 999;
                setChefTile(2, 13);
                moveChef(-1, 0);
                for (let i = 0; i < 400; i++) step(0.016);
                return chef.x;
            });
            expect(x).toBeGreaterThanOrEqual(0);
        });

        test('the chef cannot walk off the right edge', async ({ page }) => {
            const { x, w } = await page.evaluate(() => {
                startGame();
                enemies.length = 0; spawnTimer = 999;
                setChefTile(13, 13);
                moveChef(1, 0);
                for (let i = 0; i < 400; i++) step(0.016);
                return { x: chef.x, w: COLS * TILE };
            });
            expect(x).toBeLessThanOrEqual(w);
        });

        test('the chef climbs up a ladder', async ({ page }) => {
            const climbed = await page.evaluate(() => {
                startGame();
                enemies.length = 0; spawnTimer = 999;
                setChefTile(8, 13);
                const before = chef.y;
                moveChef(0, -1);
                for (let i = 0; i < 30; i++) step(0.016);
                return chef.y < before;
            });
            expect(climbed).toBe(true);
        });

        test('the chef climbs back down', async ({ page }) => {
            const descended = await page.evaluate(() => {
                startGame();
                enemies.length = 0; spawnTimer = 999;
                setChefTile(8, 10);
                const before = chef.y;
                moveChef(0, 1);
                for (let i = 0; i < 30; i++) step(0.016);
                return chef.y > before;
            });
            expect(descended).toBe(true);
        });

        test('the chef cannot climb where there is no ladder', async ({ page }) => {
            const y = await page.evaluate(() => {
                startGame();
                enemies.length = 0; spawnTimer = 999;
                setChefTile(3, 13);
                const before = chef.y;
                moveChef(0, -1);
                for (let i = 0; i < 30; i++) step(0.016);
                return chef.y - before;
            });
            expect(y).toBe(0);
        });

        test('the chef cannot climb above the top of a ladder', async ({ page }) => {
            const y = await page.evaluate(() => {
                startGame();
                enemies.length = 0; spawnTimer = 999;
                setChefTile(8, 13);
                moveChef(0, -1);
                for (let i = 0; i < 900; i++) step(0.016);
                return chef.y;
            });
            expect(y).toBe(36); // floorY(1) — the top floor
        });

        test('climbing snaps the chef onto the ladder centre line', async ({ page }) => {
            const r = await page.evaluate(() => {
                startGame();
                enemies.length = 0; spawnTimer = 999;
                setChefTile(8, 13);
                chef.x += 8; // slightly off centre, still within half a tile
                moveChef(0, -1);
                for (let i = 0; i < 5; i++) step(0.016);
                return { x: chef.x, centre: colCenter(8) };
            });
            expect(r.x).toBe(r.centre);
        });

        test('the chef cannot walk while in the middle of a ladder', async ({ page }) => {
            const moved = await page.evaluate(() => {
                startGame();
                enemies.length = 0; spawnTimer = 999;
                setChefTile(8, 13);
                moveChef(0, -1);
                for (let i = 0; i < 30; i++) step(0.016); // now mid-ladder
                moveChef(1, 0);
                const before = chef.x;
                for (let i = 0; i < 30; i++) step(0.016);
                return chef.x - before;
            });
            expect(moved).toBe(0);
        });

        test('ArrowRight moves the chef right', async ({ page }) => {
            await page.evaluate(() => {
                startGame();
                enemies.length = 0; spawnTimer = 999;
                setChefTile(8, 13);
            });
            const before = await page.evaluate(() => chef.x);
            await page.keyboard.down('ArrowRight');
            await page.evaluate(() => { for (let i = 0; i < 30; i++) step(0.016); });
            await page.keyboard.up('ArrowRight');
            expect(await page.evaluate(() => chef.x)).toBeGreaterThan(before);
        });
    });

    // -----------------------------------------------------------------------
    // Ingredients
    // -----------------------------------------------------------------------
    test.describe('ingredients', () => {
        test('walking onto an ingredient presses the segment underfoot', async ({ page }) => {
            const pressed = await page.evaluate(() => {
                startGame();
                enemies.length = 0; spawnTimer = 999;
                const ing = ingredients.find((i) => i.lane === 0 && i.row === 10);
                setChefTile(LANES[0], 10);
                step(0.016);
                return ing.segments.filter(Boolean).length;
            });
            expect(pressed).toBe(1);
        });

        test('walking the full length of an ingredient drops it', async ({ page }) => {
            const r = await page.evaluate(() => {
                startGame();
                enemies.length = 0; spawnTimer = 999;
                const ing = ingredients.find((i) => i.lane === 0 && i.row === 10);
                setChefTile(LANES[0], 10);
                moveChef(1, 0);
                for (let i = 0; i < 120; i++) step(0.016);
                return { row: ing.row, onPlate: ing.onPlate };
            });
            expect(r.row).toBe(13);
            expect(r.onPlate).toBe(true);
        });

        test('an ingredient only falls once every segment is pressed', async ({ page }) => {
            const falling = await page.evaluate(() => {
                startGame();
                enemies.length = 0; spawnTimer = 999;
                const ing = ingredients.find((i) => i.lane === 0 && i.row === 10);
                ing.segments[0] = true;
                ing.segments[1] = true;
                for (let i = 0; i < 20; i++) step(0.016);
                return ing.falling;
            });
            expect(falling).toBe(false);
        });

        test('dropIngredient sends a piece to the next floor down', async ({ page }) => {
            const row = await page.evaluate(() => {
                startGame();
                enemies.length = 0; spawnTimer = 999;
                // Clear row 4 of this lane so the drop rests instead of cascading.
                const blocker = ingredients.find((i) => i.lane === 1 && i.row === 4);
                ingredients.splice(ingredients.indexOf(blocker), 1);
                const ing = ingredients.find((i) => i.lane === 1 && i.row === 1);
                dropIngredient(ing);
                for (let i = 0; i < 200; i++) step(0.016);
                return ing.row;
            });
            expect(row).toBe(4);
        });

        test('a landing ingredient cascades the one it lands on', async ({ page }) => {
            const r = await page.evaluate(() => {
                startGame();
                enemies.length = 0; spawnTimer = 999;
                const upper = ingredients.find((i) => i.lane === 2 && i.row === 7);
                const lower = ingredients.find((i) => i.lane === 2 && i.row === 10);
                dropIngredient(upper);
                for (let i = 0; i < 400; i++) step(0.016);
                return { upper: upper.row, lower: lower.row, upperPlated: upper.onPlate, lowerPlated: lower.onPlate };
            });
            expect(r).toEqual({ upper: 13, lower: 13, upperPlated: true, lowerPlated: true });
        });

        test('a cascade stacks the lower piece underneath', async ({ page }) => {
            const r = await page.evaluate(() => {
                startGame();
                enemies.length = 0; spawnTimer = 999;
                const upper = ingredients.find((i) => i.lane === 2 && i.row === 7);
                const lower = ingredients.find((i) => i.lane === 2 && i.row === 10);
                dropIngredient(upper);
                for (let i = 0; i < 400; i++) step(0.016);
                return upper.y < lower.y; // upper ends up drawn above the lower one
            });
            expect(r).toBe(true);
        });

        test('dropping scores points', async ({ page }) => {
            const gained = await page.evaluate(() => {
                startGame();
                enemies.length = 0; spawnTimer = 999;
                score = 0;
                const blocker = ingredients.find((i) => i.lane === 3 && i.row === 4);
                ingredients.splice(ingredients.indexOf(blocker), 1);
                const ing = ingredients.find((i) => i.lane === 3 && i.row === 1);
                dropIngredient(ing);
                for (let i = 0; i < 200; i++) step(0.016);
                return score;
            });
            expect(gained).toBe(50);
        });

        test('segments reset once an ingredient lands', async ({ page }) => {
            const pressed = await page.evaluate(() => {
                startGame();
                enemies.length = 0; spawnTimer = 999;
                const ing = ingredients.find((i) => i.lane === 3 && i.row === 1);
                ing.segments.fill(true);
                for (let i = 0; i < 200; i++) step(0.016);
                return ing.segments.filter(Boolean).length;
            });
            expect(pressed).toBe(0);
        });

        test('a plated ingredient is no longer falling', async ({ page }) => {
            const r = await page.evaluate(() => {
                startGame();
                enemies.length = 0; spawnTimer = 999;
                const ing = ingredients.find((i) => i.lane === 0 && i.row === 10);
                dropIngredient(ing);
                for (let i = 0; i < 200; i++) step(0.016);
                return { falling: ing.falling, onPlate: ing.onPlate };
            });
            expect(r).toEqual({ falling: false, onPlate: true });
        });
    });

    // -----------------------------------------------------------------------
    // Enemies
    // -----------------------------------------------------------------------
    test.describe('enemies', () => {
        test('spawnEnemy places an enemy on the given tile', async ({ page }) => {
            const e = await page.evaluate(() => {
                startGame();
                enemies.length = 0; spawnTimer = 999;
                const e = spawnEnemy('dog', 4, 7);
                return { x: e.x, y: e.y, cx: colCenter(4), fy: floorY(7), count: enemies.length };
            });
            expect(e.count).toBe(1);
            expect(e.x).toBe(e.cx);
            expect(e.y).toBe(e.fy);
        });

        test('an enemy walks toward the chef on the same floor', async ({ page }) => {
            const closed = await page.evaluate(() => {
                startGame();
                enemies.length = 0; spawnTimer = 999;
                setChefTile(14, 7);
                const e = spawnEnemy('dog', 2, 7);
                const before = Math.abs(chef.x - e.x);
                for (let i = 0; i < 60; i++) step(0.016);
                return Math.abs(chef.x - e.x) < before;
            });
            expect(closed).toBe(true);
        });

        test('an enemy climbs toward a chef on a floor above', async ({ page }) => {
            const climbed = await page.evaluate(() => {
                startGame();
                enemies.length = 0; spawnTimer = 999;
                setChefTile(8, 7);
                const e = spawnEnemy('egg', 8, 13);
                const before = e.y;
                for (let i = 0; i < 60; i++) step(0.016);
                return e.y < before;
            });
            expect(climbed).toBe(true);
        });

        test('an enemy walks toward a ladder when there is none underfoot', async ({ page }) => {
            const moved = await page.evaluate(() => {
                startGame();
                enemies.length = 0; spawnTimer = 999;
                setChefTile(8, 7);
                const e = spawnEnemy('pickle', 6, 13); // col 6 ladder only spans rows 7..10
                const before = e.x;
                for (let i = 0; i < 60; i++) step(0.016);
                return Math.abs(e.x - before) > 1;
            });
            expect(moved).toBe(true);
        });

        test('enemies appear over time once the game is running', async ({ page }) => {
            const count = await page.evaluate(() => {
                startGame();
                enemies.length = 0;
                for (let i = 0; i < 400; i++) step(0.016);
                return enemies.length;
            });
            expect(count).toBeGreaterThan(0);
        });

        test('enemies are capped for the level', async ({ page }) => {
            const r = await page.evaluate(() => {
                startGame();
                enemies.length = 0;
                for (let i = 0; i < 3000; i++) step(0.016);
                return { count: enemies.length, max: maxEnemies() };
            });
            expect(r.count).toBeLessThanOrEqual(r.max);
        });

        test('touching an enemy costs a life', async ({ page }) => {
            const lives = await page.evaluate(() => {
                startGame();
                enemies.length = 0; spawnTimer = 999;
                setChefTile(8, 13);
                spawnEnemy('dog', 8, 13);
                step(0.016);
                return lives;
            });
            expect(lives).toBe(2);
        });

        test('a death clears the board of enemies', async ({ page }) => {
            const count = await page.evaluate(() => {
                startGame();
                enemies.length = 0; spawnTimer = 999;
                setChefTile(8, 13);
                spawnEnemy('dog', 8, 13);
                step(0.016);
                return enemies.length;
            });
            expect(count).toBe(0);
        });

        test('a death keeps the ingredient progress', async ({ page }) => {
            const plated = await page.evaluate(() => {
                startGame();
                enemies.length = 0; spawnTimer = 999;
                const ing = ingredients.find((i) => i.lane === 0 && i.row === 10);
                dropIngredient(ing);
                for (let i = 0; i < 200; i++) step(0.016);
                loseLife();
                return ingredients.filter((i) => i.onPlate).length;
            });
            expect(plated).toBe(1);
        });

        test('losing the last life ends the game', async ({ page }) => {
            const s = await page.evaluate(() => {
                startGame();
                enemies.length = 0; spawnTimer = 999;
                lives = 1;
                setChefTile(8, 13);
                spawnEnemy('dog', 8, 13);
                step(0.016);
                return state;
            });
            expect(s).toBe('over');
        });

        test('enemies move faster on later levels', async ({ page }) => {
            const r = await page.evaluate(() => {
                startGame();
                const slow = enemySpeed();
                level = 5;
                return { slow, fast: enemySpeed() };
            });
            expect(r.fast).toBeGreaterThan(r.slow);
        });
    });

    // -----------------------------------------------------------------------
    // Pepper
    // -----------------------------------------------------------------------
    test.describe('pepper', () => {
        test('throwing pepper spends one and makes a cloud', async ({ page }) => {
            const r = await page.evaluate(() => {
                startGame();
                enemies.length = 0; spawnTimer = 999;
                const before = pepper;
                throwPepper();
                return { before, after: pepper, clouds: clouds.length };
            });
            expect(r.after).toBe(r.before - 1);
            expect(r.clouds).toBe(1);
        });

        test('throwing with no pepper left does nothing', async ({ page }) => {
            const r = await page.evaluate(() => {
                startGame();
                enemies.length = 0; spawnTimer = 999;
                pepper = 0;
                throwPepper();
                return { pepper, clouds: clouds.length };
            });
            expect(r).toEqual({ pepper: 0, clouds: 0 });
        });

        test('pepper stuns an enemy in front of the chef', async ({ page }) => {
            const stun = await page.evaluate(() => {
                startGame();
                enemies.length = 0; spawnTimer = 999;
                setChefTile(8, 13);
                chef.dir = 1;
                const e = spawnEnemy('dog', 9, 13);
                throwPepper();
                return e.stun;
            });
            expect(stun).toBeGreaterThan(0);
        });

        test('a stunned enemy stops moving', async ({ page }) => {
            const delta = await page.evaluate(() => {
                startGame();
                enemies.length = 0; spawnTimer = 999;
                setChefTile(14, 7);
                const e = spawnEnemy('dog', 2, 7);
                e.stun = 5;
                const before = e.x;
                for (let i = 0; i < 60; i++) step(0.016);
                return Math.abs(e.x - before);
            });
            expect(delta).toBe(0);
        });

        test('a stunned enemy cannot hurt the chef', async ({ page }) => {
            const lives = await page.evaluate(() => {
                startGame();
                enemies.length = 0; spawnTimer = 999;
                setChefTile(8, 13);
                const e = spawnEnemy('dog', 8, 13);
                e.stun = 5;
                step(0.016);
                return lives;
            });
            expect(lives).toBe(3);
        });

        test('the stun wears off', async ({ page }) => {
            const stun = await page.evaluate(() => {
                startGame();
                enemies.length = 0; spawnTimer = 999;
                setChefTile(0, 1);
                const e = spawnEnemy('dog', 15, 13);
                e.stun = 0.1;
                for (let i = 0; i < 20; i++) step(0.016);
                return e.stun;
            });
            expect(stun).toBe(0);
        });

        test('Space throws pepper while the game is running', async ({ page }) => {
            await page.evaluate(() => { startGame(); enemies.length = 0; spawnTimer = 999; });
            const before = await page.evaluate(() => pepper);
            await page.keyboard.press('Space');
            expect(await page.evaluate(() => pepper)).toBe(before - 1);
        });

        test('a level grants another pepper', async ({ page }) => {
            const r = await page.evaluate(() => {
                startGame();
                const before = pepper;
                completeLevel();
                return { before, after: pepper };
            });
            expect(r.after).toBe(r.before + 1);
        });
    });

    // -----------------------------------------------------------------------
    // Squashing
    // -----------------------------------------------------------------------
    test.describe('squashing', () => {
        test('a falling ingredient squashes an enemy beneath it', async ({ page }) => {
            const count = await page.evaluate(() => {
                startGame();
                enemies.length = 0; spawnTimer = 999;
                setChefTile(0, 1);
                const ing = ingredients.find((i) => i.lane === 0 && i.row === 7);
                spawnEnemy('dog', LANES[0] + 1, 10);
                dropIngredient(ing);
                for (let i = 0; i < 200; i++) step(0.016);
                return enemies.length;
            });
            expect(count).toBe(0);
        });

        test('squashing an enemy scores', async ({ page }) => {
            const gained = await page.evaluate(() => {
                startGame();
                enemies.length = 0; spawnTimer = 999;
                setChefTile(0, 1);
                score = 0;
                const ing = ingredients.find((i) => i.lane === 0 && i.row === 7);
                spawnEnemy('dog', LANES[0] + 1, 10);
                dropIngredient(ing);
                for (let i = 0; i < 200; i++) step(0.016);
                return score;
            });
            expect(gained).toBeGreaterThanOrEqual(100);
        });

        test('a squash pushes the ingredient an extra floor down', async ({ page }) => {
            const row = await page.evaluate(() => {
                startGame();
                enemies.length = 0; spawnTimer = 999;
                setChefTile(0, 1);
                // lane 1 has nothing between rows 4 and 10 to cascade with once
                // the row-10 piece is taken out of the way.
                const bottom = ingredients.find((i) => i.lane === 1 && i.row === 10);
                ingredients.splice(ingredients.indexOf(bottom), 1);
                const ing = ingredients.find((i) => i.lane === 1 && i.row === 4);
                spawnEnemy('dog', LANES[1] + 1, 7);
                dropIngredient(ing);
                for (let i = 0; i < 300; i++) step(0.016);
                return ing.row;
            });
            expect(row).toBe(10); // 7 by itself, +1 floor for the squash
        });
    });

    // -----------------------------------------------------------------------
    // Levels
    // -----------------------------------------------------------------------
    test.describe('levels', () => {
        test('plating every ingredient completes the level', async ({ page }) => {
            const lvl = await page.evaluate(() => {
                startGame();
                enemies.length = 0; spawnTimer = 999;
                // Plate everything but one piece sitting directly above a plate.
                const last = ingredients.find((i) => i.lane === 0 && i.row === 10);
                ingredients.forEach((i) => { i.onPlate = i !== last; });
                dropIngredient(last);
                for (let i = 0; i < 600; i++) step(0.016);
                return level;
            });
            expect(lvl).toBe(2);
        });

        test('completing a level rebuilds the board', async ({ page }) => {
            const r = await page.evaluate(() => {
                startGame();
                completeLevel();
                return { count: ingredients.length, plated: ingredients.filter((i) => i.onPlate).length };
            });
            expect(r).toEqual({ count: 16, plated: 0 });
        });

        test('completing a level awards the bonus', async ({ page }) => {
            const r = await page.evaluate(() => {
                startGame();
                score = 0;
                completeLevel();
                return { score, bonus: LEVEL_BONUS };
            });
            expect(r.score).toBe(r.bonus);
        });

        test('the level counter reaches the hud', async ({ page }) => {
            await page.evaluate(() => { startGame(); completeLevel(); });
            await expect(page.locator('#level')).toHaveText('2');
        });
    });

    // -----------------------------------------------------------------------
    // Scoring & best
    // -----------------------------------------------------------------------
    test.describe('scoring', () => {
        test('best score updates on game over when beaten', async ({ page }) => {
            await page.evaluate(() => {
                startGame();
                score = 7350;
                updateHud();
                endGame();
            });
            await expect(page.locator('#best')).toHaveText('7350');
        });

        test('best score persists to localStorage', async ({ page }) => {
            await page.evaluate(() => {
                startGame();
                score = 1234;
                updateHud();
                endGame();
            });
            const stored = await page.evaluate(() => window.localStorage.getItem('burgertime-best'));
            expect(parseInt(stored, 10)).toBe(1234);
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
            const delta = await page.evaluate(() => {
                startGame();
                enemies.length = 0; spawnTimer = 999;
                const ing = ingredients.find((i) => i.lane === 0 && i.row === 1);
                dropIngredient(ing);
                togglePause();
                const before = ing.y;
                for (let i = 0; i < 30; i++) step(0.016);
                return ing.y - before;
            });
            expect(delta).toBe(0);
        });

        test('resuming lets it fall again', async ({ page }) => {
            const moved = await page.evaluate(() => {
                startGame();
                enemies.length = 0; spawnTimer = 999;
                const ing = ingredients.find((i) => i.lane === 0 && i.row === 1);
                dropIngredient(ing);
                togglePause();
                togglePause();
                const before = ing.y;
                for (let i = 0; i < 10; i++) step(0.016);
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

        test('restart after game over resets everything', async ({ page }) => {
            const r = await page.evaluate(() => {
                startGame();
                score = 999;
                level = 4;
                lives = 1;
                pepper = 0;
                ingredients.forEach((i) => { i.onPlate = true; });
                spawnEnemy('dog', 4, 7);
                endGame();
                startGame();
                return {
                    score, level, lives, pepper, state,
                    enemies: enemies.length,
                    plated: ingredients.filter((i) => i.onPlate).length,
                };
            });
            expect(r).toEqual({
                score: 0, level: 1, lives: 3, pepper: 5, state: 'running',
                enemies: 0, plated: 0,
            });
        });
    });
});
