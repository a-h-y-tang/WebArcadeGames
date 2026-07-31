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

        test('canvas is 600x520', async ({ page }) => {
            const canvas = page.locator('#canvas');
            await expect(canvas).toHaveAttribute('width', '600');
            await expect(canvas).toHaveAttribute('height', '520');
        });

        test('HUD starts at zero score, 3 lives, level 1, 5 pepper', async ({ page }) => {
            await expect(page.locator('#score')).toHaveText('0');
            await expect(page.locator('#best')).toHaveText('0');
            await expect(page.locator('#lives')).toHaveText('3');
            await expect(page.locator('#level')).toHaveText('1');
            await expect(page.locator('#pepper')).toHaveText('5');
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
    // Level layout
    // -----------------------------------------------------------------------
    test.describe('level layout', () => {
        test('there are 16 ingredients, 4 per column', async ({ page }) => {
            const counts = await page.evaluate(() => {
                startGame();
                return COL_X.map((_, c) => ingredients.filter((i) => i.col === c).length);
            });
            expect(counts).toEqual([4, 4, 4, 4]);
        });

        test('each column stacks bun top, lettuce, patty, bun bottom on floors 0-3', async ({ page }) => {
            const stack = await page.evaluate(() => {
                startGame();
                return ingredients
                    .filter((i) => i.col === 0)
                    .sort((a, b) => a.floorIndex - b.floorIndex)
                    .map((i) => [i.type, i.floorIndex]);
            });
            expect(stack).toEqual([
                ['bun-top', 0],
                ['lettuce', 1],
                ['patty', 2],
                ['bun-bottom', 3],
            ]);
        });

        test('an ingredient is four segments wide and sits on its column', async ({ page }) => {
            const r = await page.evaluate(() => {
                startGame();
                const ing = ingredients.find((i) => i.col === 2 && i.floorIndex === 0);
                return { x: ing.x, colX: COL_X[2], segs: ing.segs.length, width: ING_W, segW: SEG_W, y: ing.y, floorY: FLOOR_Y[0] };
            });
            expect(r.x).toBe(r.colX);
            expect(r.segs).toBe(4);
            expect(r.width).toBe(r.segW * 4);
            expect(r.y).toBe(r.floorY);
        });

        test('ingredients start with no segments stepped', async ({ page }) => {
            const anyStepped = await page.evaluate(() => {
                startGame();
                return ingredients.some((i) => i.segs.some(Boolean));
            });
            expect(anyStepped).toBe(false);
        });

        test('every gap between adjacent floors has at least two ladders', async ({ page }) => {
            const perGap = await page.evaluate(() =>
                FLOOR_Y.slice(0, -1).map((_, i) => LADDERS.filter((l) => l.top === i && l.bottom === i + 1).length)
            );
            expect(perGap.length).toBeGreaterThanOrEqual(4);
            expect(perGap.every((n) => n >= 2)).toBe(true);
        });

        test('no ladder overlaps an ingredient column', async ({ page }) => {
            const overlap = await page.evaluate(() =>
                LADDERS.some((l) => COL_X.some((x) => l.x + LADDER_W / 2 > x && l.x - LADDER_W / 2 < x + ING_W))
            );
            expect(overlap).toBe(false);
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
                score = 999;
                lives = 1;
                level = 7;
                pepper = 0;
                startGame();
                return { score, lives, level, pepper };
            });
            expect(s).toEqual({ score: 0, lives: 3, level: 1, pepper: 5 });
        });

        test('chef starts standing on a floor inside the canvas', async ({ page }) => {
            const c = await page.evaluate(() => {
                startGame();
                return {
                    x: chef.x,
                    ladder: chef.ladder,
                    onFloor: chef.y === FLOOR_Y[chef.floorIndex],
                };
            });
            expect(c.x).toBeGreaterThan(0);
            expect(c.x).toBeLessThan(600);
            expect(c.ladder).toBeNull();
            expect(c.onFloor).toBe(true);
        });

        test('enemies are on the board when the game starts', async ({ page }) => {
            const n = await page.evaluate(() => {
                startGame();
                return enemies.filter((e) => e.alive).length;
            });
            expect(n).toBeGreaterThanOrEqual(2);
        });
    });

    // -----------------------------------------------------------------------
    // Chef movement
    // -----------------------------------------------------------------------
    test.describe('chef movement', () => {
        test('walking right increases x and keeps the chef on the floor', async ({ page }) => {
            const r = await page.evaluate(() => {
                startGame();
                enemies.length = 0;
                setChefPos(300, 4);
                moveChef(1, 0);
                for (let i = 0; i < 30; i++) step(1 / 60);
                return { x: chef.x, y: chef.y, floorY: FLOOR_Y[4] };
            });
            expect(r.x).toBeGreaterThan(300);
            expect(r.y).toBe(r.floorY);
        });

        test('walking left decreases x', async ({ page }) => {
            const x = await page.evaluate(() => {
                startGame();
                enemies.length = 0;
                setChefPos(300, 4);
                moveChef(-1, 0);
                for (let i = 0; i < 30; i++) step(1 / 60);
                return chef.x;
            });
            expect(x).toBeLessThan(300);
        });

        test('walking sets the facing direction', async ({ page }) => {
            const f = await page.evaluate(() => {
                startGame();
                enemies.length = 0;
                setChefPos(300, 4);
                moveChef(-1, 0);
                step(1 / 60);
                const left = chef.facing;
                moveChef(1, 0);
                step(1 / 60);
                return { left, right: chef.facing };
            });
            expect(f.left).toBe(-1);
            expect(f.right).toBe(1);
        });

        test('chef cannot walk off the left edge', async ({ page }) => {
            const x = await page.evaluate(() => {
                startGame();
                enemies.length = 0;
                setChefPos(60, 4);
                moveChef(-1, 0);
                for (let i = 0; i < 600; i++) step(1 / 60);
                return chef.x;
            });
            expect(x).toBeGreaterThanOrEqual(0);
        });

        test('chef cannot walk off the right edge', async ({ page }) => {
            const x = await page.evaluate(() => {
                startGame();
                enemies.length = 0;
                setChefPos(540, 4);
                moveChef(1, 0);
                for (let i = 0; i < 600; i++) step(1 / 60);
                return chef.x;
            });
            expect(x).toBeLessThanOrEqual(600);
        });

        test('nothing moves before the game is started', async ({ page }) => {
            const same = await page.evaluate(() => {
                const before = chef.x;
                moveChef(1, 0);
                for (let i = 0; i < 30; i++) step(1 / 60);
                return chef.x === before;
            });
            expect(same).toBe(true);
        });
    });

    // -----------------------------------------------------------------------
    // Ladders
    // -----------------------------------------------------------------------
    test.describe('ladders', () => {
        test('ladderAt finds a ladder going up from a floor', async ({ page }) => {
            const found = await page.evaluate(() => {
                const ladder = LADDERS.find((l) => l.bottom === 4);
                return ladderAt(ladder.x, 4, -1) === ladder;
            });
            expect(found).toBe(true);
        });

        test('ladderAt returns null where there is no ladder', async ({ page }) => {
            const found = await page.evaluate(() => ladderAt(COL_X[0] + 10, 4, -1));
            expect(found).toBeNull();
        });

        test('ladderAt returns null for a direction with no connection', async ({ page }) => {
            const found = await page.evaluate(() => {
                const ladder = LADDERS.find((l) => l.top === 0);
                return ladderAt(ladder.x, 0, -1); // nothing above the top floor
            });
            expect(found).toBeNull();
        });

        test('pressing up at a ladder climbs toward the floor above', async ({ page }) => {
            const r = await page.evaluate(() => {
                startGame();
                enemies.length = 0;
                const ladder = LADDERS.find((l) => l.bottom === 4);
                setChefPos(ladder.x, 4);
                const before = chef.y;
                moveChef(0, -1);
                for (let i = 0; i < 10; i++) step(1 / 60);
                return { before, after: chef.y, onLadder: chef.ladder !== null, x: chef.x, ladderX: ladder.x };
            });
            expect(r.after).toBeLessThan(r.before);
            expect(r.onLadder).toBe(true);
            expect(r.x).toBe(r.ladderX);
        });

        test('climbing all the way up lands the chef on the floor above', async ({ page }) => {
            const r = await page.evaluate(() => {
                startGame();
                enemies.length = 0;
                const ladder = LADDERS.find((l) => l.bottom === 4);
                setChefPos(ladder.x, 4);
                moveChef(0, -1);
                for (let i = 0; i < 180; i++) step(1 / 60);
                return { floorIndex: chef.floorIndex, y: chef.y, target: FLOOR_Y[3], ladder: chef.ladder };
            });
            expect(r.floorIndex).toBe(3);
            expect(r.y).toBe(r.target);
            expect(r.ladder).toBeNull();
        });

        test('climbing down works too', async ({ page }) => {
            const r = await page.evaluate(() => {
                startGame();
                enemies.length = 0;
                const ladder = LADDERS.find((l) => l.top === 3);
                setChefPos(ladder.x, 3);
                moveChef(0, 1);
                for (let i = 0; i < 180; i++) step(1 / 60);
                return { floorIndex: chef.floorIndex, y: chef.y, bottomY: FLOOR_Y[4] };
            });
            expect(r.floorIndex).toBe(4);
            expect(r.y).toBe(r.bottomY);
        });

        test('pressing up away from a ladder does nothing', async ({ page }) => {
            const r = await page.evaluate(() => {
                startGame();
                enemies.length = 0;
                setChefPos(COL_X[0] + 10, 4);
                const before = chef.y;
                moveChef(0, -1);
                for (let i = 0; i < 30; i++) step(1 / 60);
                return { before, after: chef.y, ladder: chef.ladder };
            });
            expect(r.after).toBe(r.before);
            expect(r.ladder).toBeNull();
        });

        test('horizontal input is ignored while climbing', async ({ page }) => {
            const r = await page.evaluate(() => {
                startGame();
                enemies.length = 0;
                const ladder = LADDERS.find((l) => l.bottom === 4);
                setChefPos(ladder.x, 4);
                moveChef(0, -1);
                for (let i = 0; i < 10; i++) step(1 / 60);
                moveChef(1, 0);
                for (let i = 0; i < 10; i++) step(1 / 60);
                return { x: chef.x, ladderX: ladder.x };
            });
            expect(r.x).toBe(r.ladderX);
        });

        test('the chef cannot climb below the bottom floor', async ({ page }) => {
            const r = await page.evaluate(() => {
                startGame();
                enemies.length = 0;
                const ladder = LADDERS.find((l) => l.bottom === 4);
                setChefPos(ladder.x, 4);
                moveChef(0, 1);
                for (let i = 0; i < 60; i++) step(1 / 60);
                return { y: chef.y, floorY: FLOOR_Y[4] };
            });
            expect(r.y).toBe(r.floorY);
        });
    });

    // -----------------------------------------------------------------------
    // Ingredients
    // -----------------------------------------------------------------------
    test.describe('ingredients', () => {
        test('walking over a segment marks it as stepped', async ({ page }) => {
            const segs = await page.evaluate(() => {
                startGame();
                enemies.length = 0;
                setChefPos(COL_X[0] - 20, 0);
                moveChef(1, 0);
                for (let i = 0; i < 30; i++) step(1 / 60);
                const ing = ingredients.find((i) => i.col === 0 && i.floorIndex === 0);
                return ing.segs.slice();
            });
            expect(segs[0]).toBe(true);
            expect(segs[3]).toBe(false);
        });

        test('walking the whole ingredient makes it fall', async ({ page }) => {
            const r = await page.evaluate(() => {
                startGame();
                enemies.length = 0;
                const ing = ingredients.find((i) => i.col === 0 && i.floorIndex === 0);
                setChefPos(COL_X[0] - 20, 0);
                moveChef(1, 0);
                for (let i = 0; i < 180; i++) step(1 / 60);
                return { moved: ing.falling || ing.floorIndex > 0 || ing.plated, y: ing.y, floorY: FLOOR_Y[0] };
            });
            expect(r.moved).toBe(true);
            expect(r.y).toBeGreaterThan(r.floorY);
        });

        test('dropping an ingredient scores 50 points', async ({ page }) => {
            const r = await page.evaluate(() => {
                startGame();
                enemies.length = 0;
                const before = score;
                startFall(ingredients.find((i) => i.col === 2 && i.floorIndex === 0));
                return { before, after: score };
            });
            expect(r.after).toBe(r.before + 50);
        });

        test('a falling ingredient descends over time', async ({ page }) => {
            const r = await page.evaluate(() => {
                startGame();
                enemies.length = 0;
                const ing = ingredients.find((i) => i.col === 1 && i.floorIndex === 0);
                startFall(ing);
                const before = ing.y;
                step(1 / 60);
                return { before, after: ing.y };
            });
            expect(r.after).toBeGreaterThan(r.before);
        });

        test('an ingredient settles on the next empty floor with segments reset', async ({ page }) => {
            const r = await page.evaluate(() => {
                startGame();
                enemies.length = 0;
                // Take the lettuce out of column 1 so the top bun lands on a bare girder.
                const lettuce = ingredients.find((i) => i.col === 1 && i.floorIndex === 1);
                ingredients.splice(ingredients.indexOf(lettuce), 1);
                const ing = ingredients.find((i) => i.col === 1 && i.floorIndex === 0);
                startFall(ing);
                for (let i = 0; i < 120; i++) step(1 / 60);
                return { falling: ing.falling, floorIndex: ing.floorIndex, y: ing.y, floorY: FLOOR_Y[1], segs: ing.segs.slice() };
            });
            expect(r.falling).toBe(false);
            expect(r.floorIndex).toBe(1);
            expect(r.y).toBe(r.floorY);
            expect(r.segs).toEqual([false, false, false, false]);
        });

        test('landing on a resting ingredient knocks it loose (chain)', async ({ page }) => {
            const r = await page.evaluate(() => {
                startGame();
                enemies.length = 0;
                const top = ingredients.find((i) => i.col === 3 && i.floorIndex === 0);
                const below = ingredients.find((i) => i.col === 3 && i.floorIndex === 1);
                startFall(top);
                for (let i = 0; i < 90; i++) step(1 / 60);
                return { belowKnocked: below.floorIndex > 1 || below.falling || below.plated, topPassed: top.y > FLOOR_Y[1] };
            });
            expect(r.belowKnocked).toBe(true);
            expect(r.topPassed).toBe(true);
        });

        test('a chain cascades every ingredient in the column downward', async ({ page }) => {
            const r = await page.evaluate(() => {
                startGame();
                enemies.length = 0;
                const before = score;
                const column = ingredients.filter((i) => i.col === 0);
                const startFloor = new Map(column.map((i) => [i, i.floorIndex]));
                startFall(column.find((i) => i.floorIndex === 0));
                for (let i = 0; i < 600; i++) step(1 / 60);
                return {
                    plated: column.filter((i) => i.plated).length,
                    allMoved: column.every((i) => i.plated || i.floorIndex > startFloor.get(i)),
                    settled: column.every((i) => !i.falling),
                    gained: score - before,
                };
            });
            expect(r.allMoved).toBe(true);       // every piece was knocked at least one girder down
            expect(r.plated).toBeGreaterThanOrEqual(2);
            expect(r.plated).toBeLessThan(4);    // a single run must not plate the whole burger
            expect(r.settled).toBe(true);
            expect(r.gained).toBeGreaterThanOrEqual(200);
        });

        test('the first plated ingredient rests on the plate', async ({ page }) => {
            const r = await page.evaluate(() => {
                startGame();
                enemies.length = 0;
                const ing = ingredients.find((i) => i.col === 2 && i.floorIndex === 3);
                for (let f = 0; f < 3000 && !ing.plated; f++) {
                    if (!ing.falling) startFall(ing);
                    step(1 / 60);
                }
                return { y: ing.y, plateY: PLATE_Y, plated: ing.plated };
            });
            expect(r.plated).toBe(true);
            expect(r.y).toBe(r.plateY);
        });

        test('plated ingredients stack on top of each other', async ({ page }) => {
            const r = await page.evaluate(() => {
                startGame();
                enemies.length = 0;
                const drive = (ing) => {
                    for (let f = 0; f < 3000 && !ing.plated; f++) {
                        if (!ing.falling) startFall(ing);
                        step(1 / 60);
                    }
                };
                const bottom = ingredients.find((i) => i.col === 2 && i.floorIndex === 3);
                drive(bottom);
                const patty = ingredients.find((i) => i.col === 2 && i.floorIndex === 2);
                drive(patty);
                return { bottom: bottom.y, patty: patty.y, thickness: ING_H, count: platedCount(2) };
            });
            expect(r.patty).toBe(r.bottom - r.thickness);
            expect(r.count).toBe(2);
        });

        test('plated ingredients are not stepped on again', async ({ page }) => {
            const stepped = await page.evaluate(() => {
                startGame();
                enemies.length = 0;
                const ing = ingredients.find((i) => i.col === 0 && i.floorIndex === 3);
                for (let f = 0; f < 3000 && !ing.plated; f++) {
                    if (!ing.falling) startFall(ing);
                    step(1 / 60);
                }
                ing.segs = [false, false, false, false];
                setChefPos(COL_X[0] - 20, 4);
                moveChef(1, 0);
                for (let i = 0; i < 180; i++) step(1 / 60);
                return ing.segs.some(Boolean);
            });
            expect(stepped).toBe(false);
        });

        test('a falling ingredient cannot be stepped on', async ({ page }) => {
            const segs = await page.evaluate(() => {
                startGame();
                enemies.length = 0;
                const ing = ingredients.find((i) => i.col === 0 && i.floorIndex === 3);
                startFall(ing);
                ing.segs = [false, false, false, false];
                setChefPos(COL_X[0] - 20, 3);
                moveChef(1, 0);
                for (let i = 0; i < 5; i++) step(1 / 60);
                return ing.segs.some(Boolean);
            });
            expect(segs).toBe(false);
        });
    });

    // -----------------------------------------------------------------------
    // Pepper
    // -----------------------------------------------------------------------
    test.describe('pepper', () => {
        test('throwing pepper spends a shake and makes a cloud', async ({ page }) => {
            const r = await page.evaluate(() => {
                startGame();
                enemies.length = 0;
                const before = pepper;
                throwPepper();
                return { before, after: pepper, clouds: peppers.length };
            });
            expect(r.after).toBe(r.before - 1);
            expect(r.clouds).toBe(1);
        });

        test('pepper cannot be thrown when empty', async ({ page }) => {
            const clouds = await page.evaluate(() => {
                startGame();
                pepper = 0;
                throwPepper();
                return peppers.length;
            });
            expect(clouds).toBe(0);
        });

        test('pepper clouds fade away', async ({ page }) => {
            const clouds = await page.evaluate(() => {
                startGame();
                enemies.length = 0;
                throwPepper();
                for (let i = 0; i < 120; i++) step(1 / 60);
                return peppers.length;
            });
            expect(clouds).toBe(0);
        });

        test('an enemy caught in the cloud is stunned', async ({ page }) => {
            const stun = await page.evaluate(() => {
                startGame();
                enemies.length = 0;
                setChefPos(300, 4);
                moveChef(1, 0);
                step(1 / 60);
                const e = spawnEnemy(322, 4, 'hotdog');
                throwPepper();
                step(1 / 60);
                return e.stun;
            });
            expect(stun).toBeGreaterThan(0);
        });

        test('a stunned enemy does not move', async ({ page }) => {
            const r = await page.evaluate(() => {
                startGame();
                enemies.length = 0;
                setChefPos(100, 4);
                const e = spawnEnemy(500, 4, 'egg');
                e.stun = 3;
                const before = e.x;
                for (let i = 0; i < 60; i++) step(1 / 60);
                return { before, after: e.x };
            });
            expect(r.after).toBe(r.before);
        });

        test('a stunned enemy does not cost a life', async ({ page }) => {
            const remaining = await page.evaluate(() => {
                startGame();
                enemies.length = 0;
                setChefPos(300, 4);
                const e = spawnEnemy(302, 4, 'pickle');
                e.stun = 3;
                step(1 / 60);
                return lives;
            });
            expect(remaining).toBe(3);
        });

        test('stun wears off', async ({ page }) => {
            const r = await page.evaluate(() => {
                startGame();
                enemies.length = 0;
                setChefPos(100, 4);
                const e = spawnEnemy(500, 4, 'egg');
                e.stun = 0.5;
                for (let i = 0; i < 60; i++) step(1 / 60);
                return { stun: e.stun, x: e.x };
            });
            expect(r.stun).toBe(0);
            expect(r.x).toBeLessThan(500);
        });

        test('Space throws pepper while the game is running', async ({ page }) => {
            await page.keyboard.press('Space'); // starts the game
            await page.keyboard.press('Space'); // throws pepper
            expect(await page.evaluate(() => pepper)).toBe(4);
        });
    });

    // -----------------------------------------------------------------------
    // Enemies
    // -----------------------------------------------------------------------
    test.describe('enemies', () => {
        test('an enemy on the same floor walks toward the chef', async ({ page }) => {
            const r = await page.evaluate(() => {
                startGame();
                enemies.length = 0;
                setChefPos(80, 4);
                const e = spawnEnemy(500, 4, 'hotdog');
                const before = e.x;
                for (let i = 0; i < 60; i++) step(1 / 60);
                return { before, after: e.x };
            });
            expect(r.after).toBeLessThan(r.before);
        });

        test('an enemy below the chef climbs upward', async ({ page }) => {
            const r = await page.evaluate(() => {
                startGame();
                enemies.length = 0;
                setChefPos(100, 3);
                const e = spawnEnemy(180, 4, 'egg');
                const before = e.y;
                for (let i = 0; i < 300; i++) step(1 / 60);
                return { before, after: e.y };
            });
            expect(r.after).toBeLessThan(r.before);
        });

        test('an enemy above the chef climbs down', async ({ page }) => {
            const r = await page.evaluate(() => {
                startGame();
                enemies.length = 0;
                setChefPos(500, 4);
                const e = spawnEnemy(180, 2, 'pickle');
                const before = e.y;
                for (let i = 0; i < 300; i++) step(1 / 60);
                return { before, after: e.y };
            });
            expect(r.after).toBeGreaterThan(r.before);
        });

        test('touching an enemy costs a life', async ({ page }) => {
            const remaining = await page.evaluate(() => {
                startGame();
                enemies.length = 0;
                setChefPos(300, 4);
                spawnEnemy(303, 4, 'pickle');
                step(1 / 60);
                return lives;
            });
            expect(remaining).toBe(2);
        });

        test('losing a life keeps the score and the ingredient progress', async ({ page }) => {
            const r = await page.evaluate(() => {
                startGame();
                enemies.length = 0;
                score = 350;
                const ing = ingredients.find((i) => i.col === 1 && i.floorIndex === 0);
                ing.segs[0] = true;
                setChefPos(300, 4);
                spawnEnemy(303, 4, 'pickle');
                step(1 / 60);
                return { score, state, stillStepped: ing.segs[0], ingredients: ingredients.length };
            });
            expect(r.score).toBe(350);
            expect(r.state).toBe('running');
            expect(r.stillStepped).toBe(true);
            expect(r.ingredients).toBe(16);
        });

        test('a falling ingredient squashes an enemy for bonus points', async ({ page }) => {
            const r = await page.evaluate(() => {
                startGame();
                enemies.length = 0;
                setChefPos(20, 0);
                const e = spawnEnemy(COL_X[0] + 40, 4, 'hotdog');
                e.stun = 10; // hold it still under the falling ingredient
                const before = score;
                startFall(ingredients.find((i) => i.col === 0 && i.floorIndex === 3));
                for (let i = 0; i < 120; i++) step(1 / 60); // shorter than the respawn delay
                return { alive: e.alive, gained: score - before };
            });
            expect(r.alive).toBe(false);
            expect(r.gained).toBeGreaterThan(50);
        });

        test('a squashed enemy comes back after a delay', async ({ page }) => {
            const alive = await page.evaluate(() => {
                startGame();
                enemies.length = 0;
                setChefPos(300, 0);
                const e = spawnEnemy(500, 4, 'egg');
                e.alive = false;
                e.respawn = 1;
                for (let i = 0; i < 120; i++) step(1 / 60);
                return e.alive;
            });
            expect(alive).toBe(true);
        });

        test('a dead enemy cannot cost a life', async ({ page }) => {
            const remaining = await page.evaluate(() => {
                startGame();
                enemies.length = 0;
                setChefPos(300, 4);
                const e = spawnEnemy(302, 4, 'pickle');
                e.alive = false;
                e.respawn = 5;
                step(1 / 60);
                return lives;
            });
            expect(remaining).toBe(3);
        });

        test('losing every life ends the game', async ({ page }) => {
            const r = await page.evaluate(() => {
                startGame();
                enemies.length = 0;
                lives = 1;
                setChefPos(300, 4);
                spawnEnemy(303, 4, 'pickle');
                step(1 / 60);
                return { state, lives };
            });
            expect(r.state).toBe('over');
            expect(r.lives).toBe(0);
        });

        test('game over shows the overlay', async ({ page }) => {
            await page.evaluate(() => {
                startGame();
                enemies.length = 0;
                lives = 1;
                setChefPos(300, 4);
                spawnEnemy(303, 4, 'pickle');
                step(1 / 60);
            });
            await expect(page.locator('#overlay')).toHaveClass(/visible/);
            await expect(page.locator('#overlay-title')).toContainText(/game over/i);
        });

        test('the simulation stops after game over', async ({ page }) => {
            const same = await page.evaluate(() => {
                startGame();
                enemies.length = 0;
                lives = 1;
                setChefPos(300, 4);
                spawnEnemy(303, 4, 'pickle');
                step(1 / 60);
                const before = chef.x;
                moveChef(1, 0);
                for (let i = 0; i < 60; i++) step(1 / 60);
                return chef.x === before;
            });
            expect(same).toBe(true);
        });

        test('best score is saved on game over', async ({ page }) => {
            const best = await page.evaluate(() => {
                startGame();
                enemies.length = 0;
                score = 1234;
                lives = 1;
                setChefPos(300, 4);
                spawnEnemy(303, 4, 'pickle');
                step(1 / 60);
                return window.localStorage.getItem('burgertime-best');
            });
            expect(best).toBe('1234');
        });
    });

    // -----------------------------------------------------------------------
    // Level progression
    // -----------------------------------------------------------------------
    test.describe('level progression', () => {
        test('plating every ingredient clears the level', async ({ page }) => {
            const r = await page.evaluate(() => {
                startGame();
                enemies.length = 0;
                const before = score;
                ingredients.forEach((i) => {
                    i.plated = true;
                    i.falling = false;
                });
                step(1 / 60);
                return { level, gained: score - before, plated: ingredients.filter((i) => i.plated).length };
            });
            expect(r.level).toBe(2);
            expect(r.gained).toBeGreaterThanOrEqual(1000);
            expect(r.plated).toBe(0);
        });

        test('a new level restocks the burgers and refills pepper', async ({ page }) => {
            const r = await page.evaluate(() => {
                startGame();
                enemies.length = 0;
                pepper = 1;
                ingredients.forEach((i) => {
                    i.plated = true;
                    i.falling = false;
                });
                step(1 / 60);
                return {
                    count: ingredients.length,
                    floors: [...new Set(ingredients.map((i) => i.floorIndex))].sort(),
                    pepper,
                };
            });
            expect(r.count).toBe(16);
            expect(r.floors).toEqual([0, 1, 2, 3]);
            expect(r.pepper).toBeGreaterThan(1);
        });

        test('later levels have more and faster enemies', async ({ page }) => {
            const r = await page.evaluate(() => {
                startGame();
                const first = { count: enemies.length, speed: enemySpeed() };
                ingredients.forEach((i) => {
                    i.plated = true;
                    i.falling = false;
                });
                step(1 / 60);
                return { first, second: { count: enemies.length, speed: enemySpeed() } };
            });
            expect(r.second.count).toBeGreaterThan(r.first.count);
            expect(r.second.speed).toBeGreaterThan(r.first.speed);
        });

        test('enemies never outrun the chef', async ({ page }) => {
            const ok = await page.evaluate(() => {
                startGame();
                for (level = 1; level <= 20; level++) {
                    if (enemySpeed() >= CHEF_SPEED) return false;
                }
                return true;
            });
            expect(ok).toBe(true);
        });

        test('allPlated reports progress', async ({ page }) => {
            const r = await page.evaluate(() => {
                startGame();
                const start = allPlated();
                ingredients.forEach((i) => { i.plated = true; });
                return { start, end: allPlated() };
            });
            expect(r.start).toBe(false);
            expect(r.end).toBe(true);
        });
    });

    // -----------------------------------------------------------------------
    // Pause & HUD
    // -----------------------------------------------------------------------
    test.describe('pause and HUD', () => {
        test('P pauses the game and shows the overlay', async ({ page }) => {
            await page.keyboard.press('Space');
            await page.keyboard.press('p');
            expect(await page.evaluate(() => state)).toBe('paused');
            await expect(page.locator('#overlay')).toHaveClass(/visible/);
        });

        test('P resumes the game', async ({ page }) => {
            await page.keyboard.press('Space');
            await page.keyboard.press('p');
            await page.keyboard.press('p');
            expect(await page.evaluate(() => state)).toBe('running');
        });

        test('the world is frozen while paused', async ({ page }) => {
            const same = await page.evaluate(() => {
                startGame();
                enemies.length = 0;
                setChefPos(300, 4);
                moveChef(1, 0);
                togglePause();
                const before = chef.x;
                for (let i = 0; i < 60; i++) step(1 / 60);
                return chef.x === before;
            });
            expect(same).toBe(true);
        });

        test('the HUD reflects the live game state', async ({ page }) => {
            await page.evaluate(() => {
                startGame();
                enemies.length = 0;
                score = 730;
                lives = 2;
                level = 3;
                pepper = 4;
                step(1 / 60);
                togglePause();
            });
            await expect(page.locator('#score')).toHaveText('730');
            await expect(page.locator('#lives')).toHaveText('2');
            await expect(page.locator('#level')).toHaveText('3');
            await expect(page.locator('#pepper')).toHaveText('4');
        });

        test('arrow keys drive the chef through the real input handler', async ({ page }) => {
            await page.keyboard.press('Space');
            const before = await page.evaluate(() => {
                enemies.length = 0;
                setChefPos(300, 4);
                return chef.x;
            });
            await page.keyboard.down('ArrowRight');
            await page.waitForTimeout(250);
            await page.keyboard.up('ArrowRight');
            const after = await page.evaluate(() => chef.x);
            expect(after).toBeGreaterThan(before);
        });

        test('the canvas is actually painted', async ({ page }) => {
            await page.keyboard.press('Space');
            await page.waitForTimeout(100);
            const blank = await page.evaluate(() => {
                const data = ctx.getImageData(0, 0, CANVAS_W, CANVAS_H).data;
                const first = [data[0], data[1], data[2]];
                for (let i = 0; i < data.length; i += 4) {
                    if (data[i] !== first[0] || data[i + 1] !== first[1] || data[i + 2] !== first[2]) return false;
                }
                return true;
            });
            expect(blank).toBe(false);
        });
    });
});
