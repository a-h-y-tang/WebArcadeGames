const { test, expect } = require('@playwright/test');
const path = require('path');
const { pathToFileURL } = require('url');

const GAME_URL = pathToFileURL(path.resolve(__dirname, '../index.html')).href;

// Advance the simulation by `frames` fixed 1/60s steps inside the page.
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

        test('start overlay is visible', async ({ page }) => {
            await expect(page.locator('#overlay')).toHaveClass(/visible/);
        });

        test('overlay prompts the player to start', async ({ page }) => {
            await expect(page.locator('#overlay-sub')).toContainText(/space|start/i);
        });

        test('canvas is 640x480', async ({ page }) => {
            const canvas = page.locator('#canvas');
            await expect(canvas).toHaveAttribute('width', '640');
            await expect(canvas).toHaveAttribute('height', '480');
        });

        test('state is idle before starting', async ({ page }) => {
            expect(await page.evaluate(() => state)).toBe('idle');
        });

        test('score, level, lives and best show their starting values', async ({ page }) => {
            await expect(page.locator('#score')).toHaveText('0');
            await expect(page.locator('#level')).toHaveText('1');
            await expect(page.locator('#lives')).toHaveText('3');
            await expect(page.locator('#best')).toHaveText('0');
        });

        test('no enemies walk the girders before starting', async ({ page }) => {
            expect(await page.evaluate(() => enemies.length)).toBe(0);
        });

        test('best score loads from localStorage', async ({ page }) => {
            await page.evaluate(() => window.localStorage.setItem('burgertime-best', '4200'));
            await page.reload();
            await expect(page.locator('#best')).toHaveText('4200');
        });

        test('step does nothing while idle', async ({ page }) => {
            const same = await page.evaluate(() => {
                const before = JSON.stringify(chef);
                for (let i = 0; i < 30; i++) step(0.016);
                return before === JSON.stringify(chef);
            });
            expect(same).toBe(true);
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

        test('a fresh game starts on level 1 with full lives and pepper', async ({ page }) => {
            const s = await page.evaluate(() => {
                startGame();
                return { level, lives, pepper, score, state, startLives: START_LIVES, startPepper: START_PEPPER };
            });
            expect(s.level).toBe(1);
            expect(s.lives).toBe(s.startLives);
            expect(s.pepper).toBe(s.startPepper);
            expect(s.score).toBe(0);
            expect(s.state).toBe('running');
        });

        test('the chef starts on the bottom floor', async ({ page }) => {
            const c = await page.evaluate(() => {
                startGame();
                return { floor: chef.floor, y: chef.y, plateY: floorY(PLATE_FLOOR), climbing: chef.climbing };
            });
            expect(c.floor).toBe(await page.evaluate(() => PLATE_FLOOR));
            expect(c.y).toBeCloseTo(c.plateY, 3);
            expect(c.climbing).toBe(false);
        });

        test('every burger column is stocked with a full stack of layers', async ({ page }) => {
            const counts = await page.evaluate(() => {
                startGame();
                return Array.from({ length: NUM_BURGERS }, (_, col) =>
                    ingredients.filter((i) => i.col === col).length);
            });
            const layers = await page.evaluate(() => LAYERS.length);
            expect(counts).toHaveLength(await page.evaluate(() => NUM_BURGERS));
            for (const c of counts) expect(c).toBe(layers);
        });

        test('layers start above the plate floor, one per girder', async ({ page }) => {
            const ok = await page.evaluate(() => {
                startGame();
                return ingredients.every((i) => i.floor >= 0 && i.floor < PLATE_FLOOR && !i.falling);
            });
            expect(ok).toBe(true);
        });

        test('the level starts with enemies on the board', async ({ page }) => {
            const n = await page.evaluate(() => { startGame(); return enemies.length; });
            expect(n).toBeGreaterThan(0);
        });

        test('no burgers are served at the start of a level', async ({ page }) => {
            const served = await page.evaluate(() => { startGame(); return servedCount(); });
            expect(served).toBe(0);
        });
    });

    // -----------------------------------------------------------------------
    // Chef movement along girders
    // -----------------------------------------------------------------------
    test.describe('chef movement', () => {
        test('moving right increases the chef x', async ({ page }) => {
            const { before, after } = await page.evaluate(() => {
                startGame();
                enemies.length = 0;
                setChefTo(300, PLATE_FLOOR);
                const before = chef.x;
                moveChef(1, 0);
                for (let i = 0; i < 20; i++) step(0.016);
                return { before, after: chef.x };
            });
            expect(after).toBeGreaterThan(before);
        });

        test('moving left decreases the chef x', async ({ page }) => {
            const { before, after } = await page.evaluate(() => {
                startGame();
                enemies.length = 0;
                setChefTo(300, PLATE_FLOOR);
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
                setChefTo(40, PLATE_FLOOR);
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
                setChefTo(600, PLATE_FLOOR);
                moveChef(1, 0);
                for (let i = 0; i < 400; i++) step(0.016);
                return { x: chef.x, w: CANVAS_W };
            });
            expect(x).toBeLessThanOrEqual(w);
        });

        test('walking keeps the chef glued to the girder line', async ({ page }) => {
            const drift = await page.evaluate(() => {
                startGame();
                enemies.length = 0;
                setChefTo(300, 2);
                moveChef(1, 0);
                for (let i = 0; i < 30; i++) step(0.016);
                return Math.abs(chef.y - floorY(2));
            });
            expect(drift).toBeLessThan(0.001);
        });

        test('ArrowRight moves the chef right', async ({ page }) => {
            await page.evaluate(() => { startGame(); enemies.length = 0; setChefTo(300, PLATE_FLOOR); });
            const before = await page.evaluate(() => chef.x);
            await page.keyboard.down('ArrowRight');
            await page.evaluate(() => { for (let i = 0; i < 20; i++) step(0.016); });
            await page.keyboard.up('ArrowRight');
            const after = await page.evaluate(() => chef.x);
            expect(after).toBeGreaterThan(before);
        });

        test('releasing the key stops the chef', async ({ page }) => {
            await page.evaluate(() => { startGame(); enemies.length = 0; setChefTo(300, PLATE_FLOOR); });
            await page.keyboard.down('ArrowRight');
            await page.evaluate(() => { for (let i = 0; i < 10; i++) step(0.016); });
            await page.keyboard.up('ArrowRight');
            const stopped = await page.evaluate(() => {
                const x = chef.x;
                for (let i = 0; i < 20; i++) step(0.016);
                return chef.x === x;
            });
            expect(stopped).toBe(true);
        });
    });

    // -----------------------------------------------------------------------
    // Ladders
    // -----------------------------------------------------------------------
    test.describe('ladders', () => {
        test('there is a ladder between every pair of neighbouring girders', async ({ page }) => {
            const ok = await page.evaluate(() => {
                for (let f = 0; f < FLOOR_COUNT - 1; f++) {
                    if (!LADDER_XS.some((x) => hasLadder(x, f, f + 1))) return false;
                }
                return true;
            });
            expect(ok).toBe(true);
        });

        test('climbing up from a ladder reaches the girder above', async ({ page }) => {
            const c = await page.evaluate(() => {
                startGame();
                enemies.length = 0;
                setChefTo(LADDER_XS[0], PLATE_FLOOR);
                moveChef(0, -1);
                // Holding "up" keeps climbing girder after girder, so stop as
                // soon as the first one is reached.
                let guard = 0;
                while (chef.floor === PLATE_FLOOR && guard++ < 300) step(0.016);
                return { floor: chef.floor, y: chef.y, target: floorY(PLATE_FLOOR - 1) };
            });
            expect(c.floor).toBe((await page.evaluate(() => PLATE_FLOOR)) - 1);
            expect(c.y).toBeCloseTo(c.target, 3);
        });

        test('letting go early in a climb settles back onto the girder below', async ({ page }) => {
            const c = await page.evaluate(() => {
                startGame();
                enemies.length = 0;
                setChefTo(LADDER_XS[0], PLATE_FLOOR);
                moveChef(0, -1);
                for (let i = 0; i < 5; i++) step(0.016);
                moveChef(0, 0);
                for (let i = 0; i < 200; i++) step(0.016);
                return { floor: chef.floor, y: chef.y, target: floorY(PLATE_FLOOR), climbing: chef.climbing };
            });
            expect(c.floor).toBe(await page.evaluate(() => PLATE_FLOOR));
            expect(c.y).toBeCloseTo(c.target, 3);
            expect(c.climbing).toBe(false);
        });

        test('letting go late in a climb settles onto the girder above', async ({ page }) => {
            const c = await page.evaluate(() => {
                startGame();
                enemies.length = 0;
                setChefTo(LADDER_XS[0], PLATE_FLOOR);
                moveChef(0, -1);
                for (let i = 0; i < 40; i++) step(0.016);
                moveChef(0, 0);
                for (let i = 0; i < 200; i++) step(0.016);
                return { floor: chef.floor, y: chef.y, target: floorY(PLATE_FLOOR - 1), climbing: chef.climbing };
            });
            expect(c.floor).toBe((await page.evaluate(() => PLATE_FLOOR)) - 1);
            expect(c.y).toBeCloseTo(c.target, 3);
            expect(c.climbing).toBe(false);
        });

        test('a chef who stops climbing can walk again', async ({ page }) => {
            const moved = await page.evaluate(() => {
                startGame();
                enemies.length = 0;
                setChefTo(LADDER_XS[0], PLATE_FLOOR);
                moveChef(0, -1);
                // Climb one girder, then react a frame late — as a player would.
                let guard = 0;
                while (chef.floor === PLATE_FLOOR && guard++ < 300) step(0.016);
                step(0.016);
                moveChef(1, 0);
                const x0 = chef.x;
                for (let i = 0; i < 60; i++) step(0.016);
                return { dx: chef.x - x0, floor: chef.floor, climbing: chef.climbing };
            });
            expect(moved.climbing).toBe(false);
            expect(moved.dx).toBeGreaterThan(20);
        });

        test('the chef snaps onto the ladder column while climbing', async ({ page }) => {
            const x = await page.evaluate(() => {
                startGame();
                enemies.length = 0;
                setChefTo(LADDER_XS[1] + 6, PLATE_FLOOR);
                moveChef(0, -1);
                for (let i = 0; i < 10; i++) step(0.016);
                return { chefX: chef.x, ladder: LADDER_XS[1], climbing: chef.climbing };
            });
            expect(x.climbing).toBe(true);
            expect(x.chefX).toBeCloseTo(x.ladder, 3);
        });

        test('the chef cannot climb away from a ladder', async ({ page }) => {
            const c = await page.evaluate(() => {
                startGame();
                enemies.length = 0;
                // A spot deliberately far from every ladder column.
                const gap = LADDER_XS[0] + (LADDER_XS[1] - LADDER_XS[0]) / 2;
                setChefTo(gap, PLATE_FLOOR);
                moveChef(0, -1);
                for (let i = 0; i < 60; i++) step(0.016);
                return { floor: chef.floor, climbing: chef.climbing };
            });
            expect(c.climbing).toBe(false);
            expect(c.floor).toBe(await page.evaluate(() => PLATE_FLOOR));
        });

        test('the chef cannot climb above the top girder', async ({ page }) => {
            const floor = await page.evaluate(() => {
                startGame();
                enemies.length = 0;
                setChefTo(LADDER_XS[0], 0);
                moveChef(0, -1);
                for (let i = 0; i < 120; i++) step(0.016);
                return chef.floor;
            });
            expect(floor).toBe(0);
        });

        test('the chef cannot climb below the plate floor', async ({ page }) => {
            const floor = await page.evaluate(() => {
                startGame();
                enemies.length = 0;
                setChefTo(LADDER_XS[0], PLATE_FLOOR);
                moveChef(0, 1);
                for (let i = 0; i < 120; i++) step(0.016);
                return chef.floor;
            });
            expect(floor).toBe(await page.evaluate(() => PLATE_FLOOR));
        });

        test('climbing down reaches the girder below', async ({ page }) => {
            const floor = await page.evaluate(() => {
                startGame();
                enemies.length = 0;
                setChefTo(LADDER_XS[2], 1);
                moveChef(0, 1);
                let guard = 0;
                while (chef.floor === 1 && guard++ < 300) step(0.016);
                return chef.floor;
            });
            expect(floor).toBe(2);
        });

        test('the chef does not slide sideways mid-climb', async ({ page }) => {
            const moved = await page.evaluate(() => {
                startGame();
                enemies.length = 0;
                setChefTo(LADDER_XS[1], PLATE_FLOOR);
                moveChef(0, -1);
                for (let i = 0; i < 5; i++) step(0.016);
                const x = chef.x;
                moveChef(1, -1);
                for (let i = 0; i < 5; i++) step(0.016);
                return { drift: Math.abs(chef.x - x), climbing: chef.climbing };
            });
            expect(moved.climbing).toBe(true);
            expect(moved.drift).toBeLessThan(0.001);
        });
    });

    // -----------------------------------------------------------------------
    // Stepping on layers
    // -----------------------------------------------------------------------
    test.describe('stepping on layers', () => {
        test('a fresh layer has no trodden segments', async ({ page }) => {
            const ok = await page.evaluate(() => {
                startGame();
                return ingredients.every((i) => i.segs.length === SEG_COUNT && i.segs.every((s) => !s));
            });
            expect(ok).toBe(true);
        });

        test('standing on one segment marks only that segment', async ({ page }) => {
            const segs = await page.evaluate(() => {
                startGame();
                enemies.length = 0;
                const ing = topOfPile(0, 1);
                setChefTo(colLeft(0) + SEG_W / 2, ing.floor);
                step(0.016);
                return ing.segs.slice();
            });
            expect(segs[0]).toBe(true);
            expect(segs.slice(1).every((s) => s === false)).toBe(true);
        });

        test('walking the full width of a layer drops it one girder', async ({ page }) => {
            const r = await page.evaluate(() => {
                startGame();
                enemies.length = 0;
                const ing = topOfPile(0, 1);
                setChefTo(colLeft(0) - 4, ing.floor);
                moveChef(1, 0);
                for (let i = 0; i < 240; i++) step(0.016);
                return { floor: ing.floor, falling: ing.falling };
            });
            expect(r.falling).toBe(false);
            expect(r.floor).toBe(2);
        });

        test('a layer on a different girder than the chef is untouched', async ({ page }) => {
            const segs = await page.evaluate(() => {
                startGame();
                enemies.length = 0;
                const ing = topOfPile(0, 1);
                setChefTo(colLeft(0) + SEG_W / 2, PLATE_FLOOR);
                for (let i = 0; i < 10; i++) step(0.016);
                return ing.segs.slice();
            });
            expect(segs.every((s) => s === false)).toBe(true);
        });

        test('a layer buried in a pile cannot be trodden on', async ({ page }) => {
            const segs = await page.evaluate(() => {
                startGame();
                enemies.length = 0;
                const upper = topOfPile(0, 1);
                const lower = topOfPile(0, 2);
                dropIngredient(upper);
                for (let i = 0; i < 120; i++) step(0.016);
                // `lower` is now pinned underneath `upper`.
                setChefTo(colLeft(0) + SEG_W / 2, 2);
                for (let i = 0; i < 10; i++) step(0.016);
                return { lower: lower.segs.slice(), upper: upper.segs.slice(), pile: pileAt(0, 2).length };
            });
            expect(segs.pile).toBe(2);
            expect(segs.lower.every((s) => s === false)).toBe(true);
            expect(segs.upper[0]).toBe(true);
        });

        test('a dropped layer forgets its trodden segments', async ({ page }) => {
            const segs = await page.evaluate(() => {
                startGame();
                enemies.length = 0;
                const ing = topOfPile(0, 1);
                dropIngredient(ing);
                for (let i = 0; i < 120; i++) step(0.016);
                return ing.segs.slice();
            });
            expect(segs.every((s) => s === false)).toBe(true);
        });

        test('dropping a layer scores points', async ({ page }) => {
            const gained = await page.evaluate(() => {
                startGame();
                enemies.length = 0;
                const before = score;
                dropIngredient(topOfPile(0, 1));
                return score - before;
            });
            expect(gained).toBe(await page.evaluate(() => DROP_POINTS));
        });
    });

    // -----------------------------------------------------------------------
    // Falling layers
    // -----------------------------------------------------------------------
    test.describe('falling layers', () => {
        test('a dropped layer falls downward', async ({ page }) => {
            const r = await page.evaluate(() => {
                startGame();
                enemies.length = 0;
                const ing = topOfPile(0, 1);
                dropIngredient(ing);
                const y0 = ing.y;
                for (let i = 0; i < 5; i++) step(0.016);
                return { moved: ing.y > y0, falling: ing.falling };
            });
            expect(r.moved).toBe(true);
            expect(r.falling).toBe(true);
        });

        test('a layer lands on the girder below and stops', async ({ page }) => {
            const r = await page.evaluate(() => {
                startGame();
                enemies.length = 0;
                // Clear floor 2 of this column first so the layer lands on bare girder.
                const below = topOfPile(0, 2);
                ingredients.splice(ingredients.indexOf(below), 1);
                const ing = topOfPile(0, 1);
                dropIngredient(ing);
                for (let i = 0; i < 120; i++) step(0.016);
                return { floor: ing.floor, falling: ing.falling, y: ing.y, girder: floorY(2) };
            });
            expect(r.falling).toBe(false);
            expect(r.floor).toBe(2);
            expect(r.y).toBeCloseTo(r.girder, 3);
        });

        test('a layer lands on top of the pile below it', async ({ page }) => {
            const r = await page.evaluate(() => {
                startGame();
                enemies.length = 0;
                const ing = topOfPile(0, 1);
                dropIngredient(ing);
                for (let i = 0; i < 120; i++) step(0.016);
                const pile = pileAt(0, 2);
                return {
                    size: pile.length,
                    top: pile[pile.length - 1] === ing,
                    index: ing.pileIndex,
                    y: ing.y,
                    expected: floorY(2) - LAYER_H,
                };
            });
            expect(r.size).toBe(2);
            expect(r.top).toBe(true);
            expect(r.index).toBe(1);
            expect(r.y).toBeCloseTo(r.expected, 3);
        });

        test('a falling layer keeps its burger column', async ({ page }) => {
            const same = await page.evaluate(() => {
                startGame();
                enemies.length = 0;
                const ing = topOfPile(1, 1);
                const col = ing.col;
                dropIngredient(ing);
                for (let i = 0; i < 120; i++) step(0.016);
                return ing.col === col;
            });
            expect(same).toBe(true);
        });

        test('dropping the same layer twice while it falls is ignored', async ({ page }) => {
            const r = await page.evaluate(() => {
                startGame();
                enemies.length = 0;
                const ing = topOfPile(0, 1);
                dropIngredient(ing);
                const before = score;
                dropIngredient(ing);
                return { gained: score - before, falling: ing.falling };
            });
            expect(r.gained).toBe(0);
            expect(r.falling).toBe(true);
        });

        test('a layer that reaches the plate floor is served', async ({ page }) => {
            const r = await page.evaluate(() => {
                startGame();
                enemies.length = 0;
                const ing = topOfPile(0, PLATE_FLOOR - 1);
                const before = score;
                dropIngredient(ing);
                for (let i = 0; i < 200; i++) step(0.016);
                return {
                    floor: ing.floor,
                    plate: pileAt(0, PLATE_FLOOR).length,
                    gained: score - before,
                };
            });
            expect(r.floor).toBe(await page.evaluate(() => PLATE_FLOOR));
            expect(r.plate).toBe(1);
            expect(r.gained).toBeGreaterThan(await page.evaluate(() => DROP_POINTS));
        });

        test('layers already on the plate cannot be trodden on', async ({ page }) => {
            const segs = await page.evaluate(() => {
                startGame();
                enemies.length = 0;
                const ing = topOfPile(0, PLATE_FLOOR - 1);
                dropIngredient(ing);
                for (let i = 0; i < 200; i++) step(0.016);
                setChefTo(colLeft(0) + SEG_W / 2, PLATE_FLOOR);
                for (let i = 0; i < 20; i++) step(0.016);
                return ing.segs.slice();
            });
            expect(segs.every((s) => s === false)).toBe(true);
        });
    });

    // -----------------------------------------------------------------------
    // Pepper
    // -----------------------------------------------------------------------
    test.describe('pepper', () => {
        test('firing pepper spends a shaker', async ({ page }) => {
            const r = await page.evaluate(() => {
                startGame();
                enemies.length = 0;
                const before = pepper;
                const fired = firePepper();
                return { fired, before, after: pepper, clouds: peppers.length };
            });
            expect(r.fired).toBe(true);
            expect(r.after).toBe(r.before - 1);
            expect(r.clouds).toBe(1);
        });

        test('pepper cannot be fired when the shakers are empty', async ({ page }) => {
            const r = await page.evaluate(() => {
                startGame();
                enemies.length = 0;
                pepper = 0;
                const fired = firePepper();
                return { fired, clouds: peppers.length, pepper };
            });
            expect(r.fired).toBe(false);
            expect(r.clouds).toBe(0);
            expect(r.pepper).toBe(0);
        });

        test('a pepper cloud fades away', async ({ page }) => {
            const clouds = await page.evaluate(() => {
                startGame();
                enemies.length = 0;
                firePepper();
                for (let i = 0; i < 120; i++) step(0.016);
                return peppers.length;
            });
            expect(clouds).toBe(0);
        });

        test('pepper stuns an enemy in front of the chef', async ({ page }) => {
            const stun = await page.evaluate(() => {
                startGame();
                enemies.length = 0;
                setChefTo(300, PLATE_FLOOR);
                moveChef(1, 0);
                step(0.016);
                const e = spawnEnemy({ x: 320, floor: PLATE_FLOOR });
                firePepper();
                step(0.016);
                return e.stun;
            });
            expect(stun).toBeGreaterThan(0);
        });

        test('pepper does not reach an enemy behind the chef', async ({ page }) => {
            const stun = await page.evaluate(() => {
                startGame();
                enemies.length = 0;
                setChefTo(300, PLATE_FLOOR);
                moveChef(1, 0);
                step(0.016);
                const e = spawnEnemy({ x: 240, floor: PLATE_FLOOR });
                firePepper();
                step(0.016);
                return e.stun;
            });
            expect(stun).toBe(0);
        });

        test('pepper does not reach an enemy on another girder', async ({ page }) => {
            const stun = await page.evaluate(() => {
                startGame();
                enemies.length = 0;
                setChefTo(300, PLATE_FLOOR);
                moveChef(1, 0);
                step(0.016);
                const e = spawnEnemy({ x: 320, floor: 1 });
                firePepper();
                step(0.016);
                return e.stun;
            });
            expect(stun).toBe(0);
        });

        test('a stunned enemy stays put', async ({ page }) => {
            const drift = await page.evaluate(() => {
                startGame();
                enemies.length = 0;
                setChefTo(100, PLATE_FLOOR);
                const e = spawnEnemy({ x: 400, floor: PLATE_FLOOR });
                e.stun = STUN_TIME;
                const x0 = e.x;
                for (let i = 0; i < 30; i++) step(0.016);
                return Math.abs(e.x - x0);
            });
            expect(drift).toBeLessThan(0.001);
        });

        test('a stun wears off', async ({ page }) => {
            const stun = await page.evaluate(() => {
                startGame();
                enemies.length = 0;
                const e = spawnEnemy({ x: 400, floor: PLATE_FLOOR });
                e.stun = 0.2;
                for (let i = 0; i < 30; i++) step(0.016);
                return e.stun;
            });
            expect(stun).toBe(0);
        });

        test('a stunned enemy is harmless', async ({ page }) => {
            const lives = await page.evaluate(() => {
                startGame();
                enemies.length = 0;
                setChefTo(300, PLATE_FLOOR);
                const e = spawnEnemy({ x: 300, floor: PLATE_FLOOR });
                e.stun = STUN_TIME;
                for (let i = 0; i < 20; i++) step(0.016);
                return lives;
            });
            expect(lives).toBe(await page.evaluate(() => START_LIVES));
        });

        test('each level refills the pepper shakers', async ({ page }) => {
            const p = await page.evaluate(() => {
                startGame();
                pepper = 0;
                nextLevel();
                return pepper;
            });
            expect(p).toBe(await page.evaluate(() => START_PEPPER));
        });
    });

    // -----------------------------------------------------------------------
    // Enemies
    // -----------------------------------------------------------------------
    test.describe('enemies', () => {
        test('spawnEnemy places an enemy on the requested girder', async ({ page }) => {
            const e = await page.evaluate(() => {
                startGame();
                enemies.length = 0;
                const e = spawnEnemy({ x: 200, floor: 2 });
                return { x: e.x, floor: e.floor, y: e.y, girder: floorY(2), count: enemies.length };
            });
            expect(e.count).toBe(1);
            expect(e.x).toBe(200);
            expect(e.floor).toBe(2);
            expect(e.y).toBeCloseTo(e.girder, 3);
        });

        test('an enemy walks toward the chef along a girder', async ({ page }) => {
            const r = await page.evaluate(() => {
                startGame();
                enemies.length = 0;
                setChefTo(80, PLATE_FLOOR);
                const e = spawnEnemy({ x: 500, floor: PLATE_FLOOR });
                const d0 = Math.abs(e.x - chef.x);
                for (let i = 0; i < 40; i++) step(0.016);
                return { d0, d1: Math.abs(e.x - chef.x) };
            });
            expect(r.d1).toBeLessThan(r.d0);
        });

        test('enemies stay inside the play field', async ({ page }) => {
            const ok = await page.evaluate(() => {
                startGame();
                setChefTo(320, PLATE_FLOOR);
                for (let i = 0; i < 600; i++) {
                    step(0.016);
                    for (const e of enemies) {
                        if (e.x < 0 || e.x > CANVAS_W) return false;
                        if (e.floor < 0 || e.floor > PLATE_FLOOR) return false;
                    }
                }
                return true;
            });
            expect(ok).toBe(true);
        });

        test('an enemy climbs toward a chef on another girder', async ({ page }) => {
            const climbed = await page.evaluate(() => {
                startGame();
                enemies.length = 0;
                setChefTo(LADDER_XS[0], 0);
                const e = spawnEnemy({ x: LADDER_XS[0], floor: PLATE_FLOOR });
                let sawClimb = false;
                for (let i = 0; i < 400; i++) {
                    step(0.016);
                    if (e.floor < PLATE_FLOOR || e.climbing) sawClimb = true;
                }
                return sawClimb;
            });
            expect(climbed).toBe(true);
        });

        test('touching an enemy costs a life and resets the chef', async ({ page }) => {
            const r = await page.evaluate(() => {
                startGame();
                enemies.length = 0;
                setChefTo(300, 2);
                spawnEnemy({ x: 300, floor: 2 });
                for (let i = 0; i < 10; i++) step(0.016);
                return { lives, floor: chef.floor, state };
            });
            expect(r.lives).toBe((await page.evaluate(() => START_LIVES)) - 1);
            expect(r.floor).toBe(await page.evaluate(() => PLATE_FLOOR));
            expect(r.state).toBe('running');
        });

        test('an enemy on another girder is harmless', async ({ page }) => {
            const lives = await page.evaluate(() => {
                startGame();
                enemies.length = 0;
                setChefTo(300, 2);
                const e = spawnEnemy({ x: 300, floor: 0 });
                e.stun = 999; // keep it from walking over
                for (let i = 0; i < 20; i++) step(0.016);
                return lives;
            });
            expect(lives).toBe(await page.evaluate(() => START_LIVES));
        });

        test('losing the last life ends the game', async ({ page }) => {
            const s = await page.evaluate(() => {
                startGame();
                enemies.length = 0;
                lives = 1;
                setChefTo(300, 2);
                spawnEnemy({ x: 300, floor: 2 });
                for (let i = 0; i < 10; i++) step(0.016);
                return { state, lives };
            });
            expect(s.state).toBe('over');
            expect(s.lives).toBe(0);
        });

        test('a falling layer squashes an enemy for a bonus', async ({ page }) => {
            const r = await page.evaluate(() => {
                startGame();
                enemies.length = 0;
                const ing = topOfPile(0, 1);
                const e = spawnEnemy({ x: colLeft(0) + ING_W / 2, floor: 2 });
                const before = score;
                dropIngredient(ing);
                for (let i = 0; i < 120; i++) step(0.016);
                return { dead: e.dead, gained: score - before, alive: enemies.includes(e) };
            });
            expect(r.dead).toBe(true);
            expect(r.gained).toBeGreaterThanOrEqual(await page.evaluate(() => SQUASH_POINTS));
        });

        test('a squashed enemy comes back later', async ({ page }) => {
            const r = await page.evaluate(() => {
                startGame();
                enemies.length = 0;
                const e = spawnEnemy({ x: 300, floor: 2 });
                squashEnemy(e);
                const dead = e.dead;
                for (let i = 0; i < 600; i++) step(0.016);
                return { dead, aliveAgain: enemies.some((x) => !x.dead) };
            });
            expect(r.dead).toBe(true);
            expect(r.aliveAgain).toBe(true);
        });

        test('a squashed enemy cannot hurt the chef', async ({ page }) => {
            const lives = await page.evaluate(() => {
                startGame();
                enemies.length = 0;
                setChefTo(300, 2);
                const e = spawnEnemy({ x: 300, floor: 2 });
                squashEnemy(e);
                for (let i = 0; i < 5; i++) step(0.016);
                return lives;
            });
            expect(lives).toBe(await page.evaluate(() => START_LIVES));
        });

        test('later levels field faster enemies', async ({ page }) => {
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
    // Serving burgers and levels
    // -----------------------------------------------------------------------
    test.describe('burgers and levels', () => {
        test('a burger counts as served once all its layers are plated', async ({ page }) => {
            const r = await page.evaluate(() => {
                startGame();
                enemies.length = 0;
                serveColumn(0);
                return { served: servedCount(), plate: pileAt(0, PLATE_FLOOR).length };
            });
            expect(r.plate).toBe(await page.evaluate(() => LAYERS.length));
            expect(r.served).toBe(1);
        });

        test('serving a burger pays a bonus', async ({ page }) => {
            const gained = await page.evaluate(() => {
                startGame();
                enemies.length = 0;
                const before = score;
                serveColumn(0);
                return score - before;
            });
            expect(gained).toBeGreaterThanOrEqual(await page.evaluate(() => BURGER_POINTS));
        });

        test('serving every burger advances the level', async ({ page }) => {
            const r = await page.evaluate(() => {
                startGame();
                enemies.length = 0;
                for (let col = 0; col < NUM_BURGERS; col++) serveColumn(col);
                return { level, served: servedCount(), state };
            });
            expect(r.level).toBe(2);
            expect(r.served).toBe(0);
            expect(r.state).toBe('running');
        });

        test('a new level restocks every burger above the plates', async ({ page }) => {
            const ok = await page.evaluate(() => {
                startGame();
                enemies.length = 0;
                for (let col = 0; col < NUM_BURGERS; col++) serveColumn(col);
                return ingredients.length === NUM_BURGERS * LAYERS.length &&
                    ingredients.every((i) => i.floor < PLATE_FLOOR && !i.falling);
            });
            expect(ok).toBe(true);
        });

        test('clearing a level pays a level bonus', async ({ page }) => {
            const gained = await page.evaluate(() => {
                startGame();
                enemies.length = 0;
                for (let col = 0; col < NUM_BURGERS - 1; col++) serveColumn(col);
                const before = score;
                serveColumn(NUM_BURGERS - 1);
                return score - before;
            });
            expect(gained).toBeGreaterThan(await page.evaluate(() => BURGER_POINTS));
        });

        test('a new level puts the chef back on the plate floor', async ({ page }) => {
            const floor = await page.evaluate(() => {
                startGame();
                enemies.length = 0;
                setChefTo(200, 0);
                nextLevel();
                return chef.floor;
            });
            expect(floor).toBe(await page.evaluate(() => PLATE_FLOOR));
        });

        test('a new level keeps the score and lives', async ({ page }) => {
            const r = await page.evaluate(() => {
                startGame();
                score = 1234;
                lives = 2;
                nextLevel();
                return { score, lives };
            });
            expect(r.score).toBeGreaterThanOrEqual(1234);
            expect(r.lives).toBe(2);
        });
    });

    // -----------------------------------------------------------------------
    // HUD, scoring and best
    // -----------------------------------------------------------------------
    test.describe('hud and scoring', () => {
        test('the HUD mirrors the game state', async ({ page }) => {
            await page.evaluate(() => {
                startGame();
                score = 777;
                level = 3;
                lives = 2;
                pepper = 4;
                updateHud();
            });
            await expect(page.locator('#score')).toHaveText('777');
            await expect(page.locator('#level')).toHaveText('3');
            await expect(page.locator('#lives')).toHaveText('2');
            await expect(page.locator('#pepper')).toHaveText('4');
        });

        test('best score updates on game over when beaten', async ({ page }) => {
            await page.evaluate(() => { startGame(); score = 5150; endGame(); });
            await expect(page.locator('#best')).toHaveText('5150');
        });

        test('best score persists to localStorage', async ({ page }) => {
            await page.evaluate(() => { startGame(); score = 2500; endGame(); });
            const stored = await page.evaluate(() => window.localStorage.getItem('burgertime-best'));
            expect(parseInt(stored, 10)).toBe(2500);
        });

        test('best score is not lowered by a worse run', async ({ page }) => {
            await page.evaluate(() => window.localStorage.setItem('burgertime-best', '9999'));
            await page.reload();
            await page.evaluate(() => { startGame(); score = 10; endGame(); });
            await expect(page.locator('#best')).toHaveText('9999');
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
        test('pausing freezes the chef', async ({ page }) => {
            const r = await page.evaluate(() => {
                startGame();
                enemies.length = 0;
                setChefTo(300, PLATE_FLOOR);
                moveChef(1, 0);
                togglePause();
                const x = chef.x;
                for (let i = 0; i < 20; i++) step(0.016);
                return { x, after: chef.x, state };
            });
            expect(r.state).toBe('paused');
            expect(r.after).toBe(r.x);
        });

        test('resuming lets the chef walk again', async ({ page }) => {
            const moved = await page.evaluate(() => {
                startGame();
                enemies.length = 0;
                setChefTo(300, PLATE_FLOOR);
                moveChef(1, 0);
                togglePause();
                togglePause();
                const x = chef.x;
                for (let i = 0; i < 20; i++) step(0.016);
                return chef.x > x;
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

        test('a paused game freezes falling layers', async ({ page }) => {
            const same = await page.evaluate(() => {
                startGame();
                enemies.length = 0;
                const ing = topOfPile(0, 1);
                dropIngredient(ing);
                togglePause();
                const y = ing.y;
                for (let i = 0; i < 20; i++) step(0.016);
                return ing.y === y;
            });
            expect(same).toBe(true);
        });

        test('restart resets score, level, lives, layers and enemies', async ({ page }) => {
            const r = await page.evaluate(() => {
                startGame();
                score = 4321;
                level = 7;
                lives = 1;
                dropIngredient(topOfPile(0, 1));
                endGame();
                startGame();
                return {
                    score, level, lives, state,
                    layers: ingredients.length,
                    falling: ingredients.filter((i) => i.falling).length,
                    served: servedCount(),
                };
            });
            expect(r.score).toBe(0);
            expect(r.level).toBe(1);
            expect(r.lives).toBe(await page.evaluate(() => START_LIVES));
            expect(r.state).toBe('running');
            expect(r.layers).toBe(await page.evaluate(() => NUM_BURGERS * LAYERS.length));
            expect(r.falling).toBe(0);
            expect(r.served).toBe(0);
        });

        test('Space restarts after a game over', async ({ page }) => {
            await page.evaluate(() => { startGame(); endGame(); });
            await page.keyboard.press('Space');
            expect(await page.evaluate(() => state)).toBe('running');
        });
    });

    // -----------------------------------------------------------------------
    // Rendering smoke test
    // -----------------------------------------------------------------------
    test.describe('rendering', () => {
        test('the canvas is painted after a frame', async ({ page }) => {
            const painted = await page.evaluate(async () => {
                startGame();
                draw();
                const ctx2 = canvas.getContext('2d');
                const data = ctx2.getImageData(0, 0, CANVAS_W, CANVAS_H).data;
                for (let i = 0; i < data.length; i += 4) {
                    if (data[i] || data[i + 1] || data[i + 2]) return true;
                }
                return false;
            });
            expect(painted).toBe(true);
        });

        test('a pepper cloud is painted in front of the chef', async ({ page }) => {
            const diff = await page.evaluate(() => {
                startGame();
                enemies.length = 0;
                setChefTo(300, 2);
                moveChef(1, 0);
                step(0.016);
                draw();
                const box = [320, floorY(2) - PEPPER_H, 60, PEPPER_H];
                const before = ctx.getImageData(...box).data.slice();
                firePepper();
                draw();
                const after = ctx.getImageData(...box).data;
                let changed = 0;
                for (let i = 0; i < after.length; i += 4) if (after[i] !== before[i]) changed += 1;
                return changed;
            });
            expect(diff).toBeGreaterThan(0);
        });

        test('no console errors during play', async ({ page }) => {
            const errors = [];
            page.on('pageerror', (e) => errors.push(String(e)));
            await page.evaluate(() => {
                startGame();
                setChefTo(320, PLATE_FLOOR);
                moveChef(1, 0);
                for (let i = 0; i < 300; i++) { step(0.016); draw(); }
            });
            expect(errors).toEqual([]);
        });
    });
});
