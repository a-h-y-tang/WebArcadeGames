const { test, expect } = require('@playwright/test');
const path = require('path');
const { pathToFileURL } = require('url');

const GAME_URL = pathToFileURL(path.resolve(__dirname, '../index.html')).href;

// Start a game with the enemy spawner disabled so tests stay deterministic.
const QUIET_START = `startGame(); autoSpawn = false; enemies.length = 0;`;

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

        test('score and best start at 0', async ({ page }) => {
            await expect(page.locator('#score')).toHaveText('0');
            await expect(page.locator('#best')).toHaveText('0');
        });

        test('canvas is 640x600', async ({ page }) => {
            const canvas = page.locator('#canvas');
            await expect(canvas).toHaveAttribute('width', '640');
            await expect(canvas).toHaveAttribute('height', '600');
        });

        test('state is idle before starting', async ({ page }) => {
            expect(await page.evaluate(() => state)).toBe('idle');
        });

        test('the board is laid out before starting', async ({ page }) => {
            const n = await page.evaluate(() => ingredients.length);
            expect(n).toBe(16);
        });

        test('best score loads from localStorage', async ({ page }) => {
            await page.evaluate(() => window.localStorage.setItem('burgertime-best', '4210'));
            await page.reload();
            await expect(page.locator('#best')).toHaveText('4210');
        });
    });

    // -----------------------------------------------------------------------
    // Board geometry
    // -----------------------------------------------------------------------
    test.describe('board geometry', () => {
        test('there are five girders, top to bottom', async ({ page }) => {
            const ys = await page.evaluate(() => FLOOR_YS.slice());
            expect(ys).toHaveLength(5);
            for (let i = 1; i < ys.length; i++) expect(ys[i]).toBeGreaterThan(ys[i - 1]);
        });

        test('the plate sits below the bottom girder', async ({ page }) => {
            const { tray, bottom } = await page.evaluate(() => ({
                tray: TRAY_Y,
                bottom: FLOOR_YS[FLOOR_YS.length - 1],
            }));
            expect(tray).toBeGreaterThan(bottom);
        });

        test('every pair of girders is joined by at least one ladder', async ({ page }) => {
            const lanes = await page.evaluate(() => LADDER_LANES.map((l) => l.length));
            expect(lanes).toHaveLength(4);
            for (const count of lanes) expect(count).toBeGreaterThan(0);
        });

        test('ladder lanes never overlap a burger column', async ({ page }) => {
            const clear = await page.evaluate(() => LADDER_XS.every((lx) =>
                COLUMN_X.every((cx) => lx + 8 <= cx || lx - 8 >= cx + ING_W)));
            expect(clear).toBe(true);
        });

        test('ingredients are laid out four per column on the top four girders', async ({ page }) => {
            const layout = await page.evaluate(() => ingredients.map((i) => [i.col, i.floor, i.kind]));
            expect(layout).toHaveLength(16);
            for (let col = 0; col < 4; col++) {
                for (let k = 0; k < 4; k++) {
                    expect(layout[col * 4 + k][0]).toBe(col);
                    expect(layout[col * 4 + k][1]).toBe(k);
                }
            }
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

        test('a new game starts on level 1 with full lives and peppers', async ({ page }) => {
            const s = await page.evaluate(() => {
                startGame();
                return { level, lives, pepperCount, score };
            });
            expect(s.level).toBe(1);
            expect(s.lives).toBe(3);
            expect(s.pepperCount).toBe(5);
            expect(s.score).toBe(0);
        });

        test('the chef starts on the bottom girder', async ({ page }) => {
            const c = await page.evaluate(() => {
                startGame();
                return { floor: chef.floor, mode: chef.mode, y: chef.y, bottom: FLOOR_COUNT - 1 };
            });
            expect(c.floor).toBe(c.bottom);
            expect(c.mode).toBe('walk');
        });

        test('the plate is empty at the start of a game', async ({ page }) => {
            const counts = await page.evaluate(() => {
                startGame();
                return tray.map((t) => t.length);
            });
            expect(counts).toEqual([0, 0, 0, 0]);
        });
    });

    // -----------------------------------------------------------------------
    // Chef movement
    // -----------------------------------------------------------------------
    test.describe('chef movement', () => {
        test('walking right increases x', async ({ page }) => {
            const { before, after } = await page.evaluate(() => {
                startGame(); autoSpawn = false; enemies.length = 0;
                setChef(300, 4);
                const before = chef.x;
                setChefDir(1, 0);
                for (let i = 0; i < 10; i++) step(0.016);
                return { before, after: chef.x };
            });
            expect(after).toBeGreaterThan(before);
        });

        test('walking left decreases x', async ({ page }) => {
            const { before, after } = await page.evaluate(() => {
                startGame(); autoSpawn = false; enemies.length = 0;
                setChef(300, 4);
                const before = chef.x;
                setChefDir(-1, 0);
                for (let i = 0; i < 10; i++) step(0.016);
                return { before, after: chef.x };
            });
            expect(after).toBeLessThan(before);
        });

        test('the chef cannot walk off the left edge', async ({ page }) => {
            const x = await page.evaluate(() => {
                startGame(); autoSpawn = false; enemies.length = 0;
                setChef(40, 4);
                setChefDir(-1, 0);
                for (let i = 0; i < 300; i++) step(0.016);
                return chef.x;
            });
            expect(x).toBeGreaterThanOrEqual(0);
        });

        test('the chef cannot walk off the right edge', async ({ page }) => {
            const { x, w } = await page.evaluate(() => {
                startGame(); autoSpawn = false; enemies.length = 0;
                setChef(600, 4);
                setChefDir(1, 0);
                for (let i = 0; i < 300; i++) step(0.016);
                return { x: chef.x, w: CANVAS_W };
            });
            expect(x).toBeLessThanOrEqual(w);
        });

        test('ArrowRight walks the chef right', async ({ page }) => {
            await page.evaluate(() => {
                startGame(); autoSpawn = false; enemies.length = 0;
                setChef(300, 4);
            });
            const before = await page.evaluate(() => chef.x);
            await page.keyboard.down('ArrowRight');
            await page.evaluate(() => { for (let i = 0; i < 10; i++) step(0.016); });
            await page.keyboard.up('ArrowRight');
            const after = await page.evaluate(() => chef.x);
            expect(after).toBeGreaterThan(before);
        });
    });

    // -----------------------------------------------------------------------
    // Ladders
    // -----------------------------------------------------------------------
    test.describe('ladders', () => {
        test('pressing up on a ladder climbs to the girder above', async ({ page }) => {
            const c = await page.evaluate(() => {
                startGame(); autoSpawn = false; enemies.length = 0;
                const lane = LADDER_LANES[3][0];
                setChef(LADDER_XS[lane], 4);
                setChefDir(0, -1);
                for (let i = 0; i < 120; i++) step(0.016);
                return { floor: chef.floor, mode: chef.mode, y: chef.y };
            });
            expect(c.floor).toBe(3);
            expect(c.mode).toBe('walk');
        });

        test('pressing down on a ladder climbs to the girder below', async ({ page }) => {
            const c = await page.evaluate(() => {
                startGame(); autoSpawn = false; enemies.length = 0;
                const lane = LADDER_LANES[3][0];
                setChef(LADDER_XS[lane], 3);
                setChefDir(0, 1);
                for (let i = 0; i < 120; i++) step(0.016);
                return { floor: chef.floor, mode: chef.mode };
            });
            expect(c.floor).toBe(4);
            expect(c.mode).toBe('walk');
        });

        test('pressing up away from a ladder does nothing', async ({ page }) => {
            const c = await page.evaluate(() => {
                startGame(); autoSpawn = false; enemies.length = 0;
                // Half way between two ladder lanes on the bottom girder.
                const lanes = LADDER_LANES[3];
                const x = (LADDER_XS[lanes[0]] + LADDER_XS[lanes[1]]) / 2;
                setChef(x, 4);
                setChefDir(0, -1);
                for (let i = 0; i < 60; i++) step(0.016);
                return { floor: chef.floor, mode: chef.mode };
            });
            expect(c.floor).toBe(4);
            expect(c.mode).toBe('walk');
        });

        test('the chef cannot climb above the top girder', async ({ page }) => {
            const c = await page.evaluate(() => {
                startGame(); autoSpawn = false; enemies.length = 0;
                setChef(LADDER_XS[0], 0);
                setChefDir(0, -1);
                for (let i = 0; i < 120; i++) step(0.016);
                return { floor: chef.floor, y: chef.y, top: FLOOR_YS[0] };
            });
            expect(c.floor).toBe(0);
            expect(c.y).toBe(c.top);
        });

        test('the chef cannot climb below the bottom girder', async ({ page }) => {
            const c = await page.evaluate(() => {
                startGame(); autoSpawn = false; enemies.length = 0;
                setChef(LADDER_XS[0], FLOOR_COUNT - 1);
                setChefDir(0, 1);
                for (let i = 0; i < 120; i++) step(0.016);
                return { floor: chef.floor, y: chef.y, bottom: FLOOR_YS[FLOOR_COUNT - 1] };
            });
            expect(c.floor).toBe(4);
            expect(c.y).toBe(c.bottom);
        });
    });

    // -----------------------------------------------------------------------
    // Stamping ingredients
    // -----------------------------------------------------------------------
    test.describe('stamping ingredients', () => {
        test('standing on a segment stamps it', async ({ page }) => {
            const segs = await page.evaluate(() => {
                startGame(); autoSpawn = false; enemies.length = 0;
                setChef(COLUMN_X[0] + SEG_W / 2, 0);
                step(0.016);
                return ingredients[0].segs.slice();
            });
            expect(segs[0]).toBe(true);
            expect(segs[1]).toBe(false);
        });

        test('a segment on another floor is not stamped', async ({ page }) => {
            const segs = await page.evaluate(() => {
                startGame(); autoSpawn = false; enemies.length = 0;
                setChef(COLUMN_X[0] + SEG_W / 2, 4);
                step(0.016);
                return ingredients[0].segs.slice();
            });
            expect(segs).toEqual([false, false, false, false]);
        });

        test('walking across the whole ingredient drops it one floor', async ({ page }) => {
            const r = await page.evaluate(() => {
                startGame(); autoSpawn = false; enemies.length = 0;
                setChef(COLUMN_X[0] - 20, 0);
                setChefDir(1, 0);
                for (let i = 0; i < 200; i++) step(0.016);
                return { floor: ingredients[0].floor, falling: ingredients[0].falling };
            });
            expect(r.floor).toBe(1);
            expect(r.falling).toBe(false);
        });

        test('a dropped ingredient has its segments reset when it lands', async ({ page }) => {
            const segs = await page.evaluate(() => {
                startGame(); autoSpawn = false; enemies.length = 0;
                dropIngredient(ingredients[0]);
                for (let i = 0; i < 120; i++) step(0.016);
                return ingredients[0].segs.slice();
            });
            expect(segs).toEqual([false, false, false, false]);
        });
    });

    // -----------------------------------------------------------------------
    // Falling ingredients
    // -----------------------------------------------------------------------
    test.describe('falling ingredients', () => {
        test('a dropping ingredient moves downward', async ({ page }) => {
            const { before, after } = await page.evaluate(() => {
                startGame(); autoSpawn = false; enemies.length = 0;
                dropIngredient(ingredients[0]);
                const before = ingredients[0].y;
                step(0.05);
                return { before, after: ingredients[0].y };
            });
            expect(after).toBeGreaterThan(before);
        });

        test('an ingredient lands on the girder below', async ({ page }) => {
            const r = await page.evaluate(() => {
                startGame(); autoSpawn = false; enemies.length = 0;
                // Column 3's bun top has nothing under it once the rest are gone.
                const ing = ingredients[0];
                ingredients.filter((i) => i.col === 0 && i !== ing).forEach((i) => { i.col = -1; });
                dropIngredient(ing);
                for (let i = 0; i < 120; i++) step(0.016);
                return { floor: ing.floor, y: ing.y, target: FLOOR_YS[1], falling: ing.falling };
            });
            expect(r.floor).toBe(1);
            expect(r.falling).toBe(false);
            expect(r.y).toBe(r.target);
        });

        test('landing on a resting ingredient knocks it down too', async ({ page }) => {
            const r = await page.evaluate(() => {
                startGame(); autoSpawn = false; enemies.length = 0;
                dropIngredient(ingredients[0]);
                for (let i = 0; i < 200; i++) step(0.016);
                return ingredients.slice(0, 4).map((i) => i.floor);
            });
            // bun top 0->1, lettuce 1->2, patty 2->3, bun bottom 3->4
            expect(r).toEqual([1, 2, 3, 4]);
        });

        test('a drop scores points', async ({ page }) => {
            const s = await page.evaluate(() => {
                startGame(); autoSpawn = false; enemies.length = 0;
                dropIngredient(ingredients[0]);
                for (let i = 0; i < 120; i++) step(0.016);
                return score;
            });
            expect(s).toBeGreaterThan(0);
        });

        test('a ripple pays more than the same number of single drops', async ({ page }) => {
            const r = await page.evaluate(() => {
                startGame(); autoSpawn = false; enemies.length = 0;
                // An isolated ingredient with nothing under it: no ripple.
                const solo = ingredients[12];
                ingredients.filter((i) => i.col === 3 && i !== solo).forEach((i) => { i.col = -1; });
                let mark = score;
                dropIngredient(solo);
                for (let i = 0; i < 120; i++) step(0.016);
                const soloGain = score - mark;
                // Column 0 is a full stack, so one drop ripples all four down.
                mark = score;
                dropIngredient(ingredients[0]);
                for (let i = 0; i < 200; i++) step(0.016);
                return { soloGain, rippleGain: score - mark };
            });
            expect(r.soloGain).toBe(50);
            expect(r.rippleGain).toBeGreaterThan(4 * r.soloGain);
        });

        test('an ingredient dropped off the bottom girder lands on the plate', async ({ page }) => {
            const r = await page.evaluate(() => {
                startGame(); autoSpawn = false; enemies.length = 0;
                const ing = ingredients[3];
                ing.floor = FLOOR_COUNT - 1;
                ing.y = FLOOR_YS[FLOOR_COUNT - 1];
                dropIngredient(ing);
                for (let i = 0; i < 120; i++) step(0.016);
                return { inTray: ing.inTray, tray: tray[0].length };
            });
            expect(r.inTray).toBe(true);
            expect(r.tray).toBe(1);
        });

        test('an already-falling ingredient cannot be dropped again', async ({ page }) => {
            const again = await page.evaluate(() => {
                startGame(); autoSpawn = false; enemies.length = 0;
                dropIngredient(ingredients[0]);
                return dropIngredient(ingredients[0]);
            });
            expect(again).toBe(false);
        });
    });

    // -----------------------------------------------------------------------
    // Burgers and levels
    // -----------------------------------------------------------------------
    test.describe('burgers and levels', () => {
        test('completing a column serves a burger and scores a bonus', async ({ page }) => {
            const r = await page.evaluate(() => {
                startGame(); autoSpawn = false; enemies.length = 0;
                for (const ing of ingredients.filter((i) => i.col === 0)) {
                    ing.floor = FLOOR_COUNT - 1;
                    ing.y = FLOOR_YS[FLOOR_COUNT - 1];
                    dropIngredient(ing);
                    for (let i = 0; i < 90; i++) step(0.016);
                }
                return { tray: tray[0].length, score };
            });
            expect(r.tray).toBe(4);
            expect(r.score).toBeGreaterThanOrEqual(500);
        });

        test('serving every burger advances to the next level', async ({ page }) => {
            const r = await page.evaluate(() => {
                startGame(); autoSpawn = false; enemies.length = 0;
                for (const ing of ingredients.slice()) {
                    ing.floor = FLOOR_COUNT - 1;
                    ing.y = FLOOR_YS[FLOOR_COUNT - 1];
                    dropIngredient(ing);
                    for (let i = 0; i < 90; i++) step(0.016);
                }
                return { level, tray: tray.map((t) => t.length), count: ingredients.length };
            });
            expect(r.level).toBe(2);
            expect(r.tray).toEqual([0, 0, 0, 0]);
            expect(r.count).toBe(16);
        });

        test('enemies get faster on later levels', async ({ page }) => {
            const r = await page.evaluate(() => {
                startGame();
                level = 1;
                const slow = enemySpeed();
                level = 5;
                return { slow, fast: enemySpeed() };
            });
            expect(r.fast).toBeGreaterThan(r.slow);
        });
    });

    // -----------------------------------------------------------------------
    // Enemies
    // -----------------------------------------------------------------------
    test.describe('enemies', () => {
        test('spawnEnemy places an enemy on the board', async ({ page }) => {
            const r = await page.evaluate(() => {
                startGame(); autoSpawn = false; enemies.length = 0;
                spawnEnemy({ x: 200, floor: 4 });
                return { n: enemies.length, x: enemies[0].x, floor: enemies[0].floor };
            });
            expect(r.n).toBe(1);
            expect(r.x).toBe(200);
            expect(r.floor).toBe(4);
        });

        test('an enemy walks toward the chef on the same girder', async ({ page }) => {
            const r = await page.evaluate(() => {
                startGame(); autoSpawn = false; enemies.length = 0;
                setChef(100, 4);
                spawnEnemy({ x: 500, floor: 4 });
                const before = enemies[0].x;
                for (let i = 0; i < 20; i++) step(0.016);
                return { before, after: enemies[0].x };
            });
            expect(r.after).toBeLessThan(r.before);
        });

        test('an enemy climbs a ladder to reach the chef', async ({ page }) => {
            const floor = await page.evaluate(() => {
                startGame(); autoSpawn = false; enemies.length = 0;
                setChef(600, 2);
                const lane = LADDER_LANES[3][0];
                spawnEnemy({ x: LADDER_XS[lane], floor: 4 });
                for (let i = 0; i < 200; i++) step(0.016);
                return enemies.length ? enemies[0].floor : -1;
            });
            expect(floor).toBeLessThan(4);
            expect(floor).toBeGreaterThanOrEqual(0);
        });

        test('touching an enemy costs a life', async ({ page }) => {
            const r = await page.evaluate(() => {
                startGame(); autoSpawn = false; enemies.length = 0;
                setChef(300, 4);
                spawnEnemy({ x: 300, floor: 4 });
                for (let i = 0; i < 5; i++) step(0.016);
                return { lives, enemies: enemies.length };
            });
            expect(r.lives).toBe(2);
            expect(r.enemies).toBe(0);
        });

        test('losing a life keeps the ingredient progress', async ({ page }) => {
            const r = await page.evaluate(() => {
                startGame(); autoSpawn = false; enemies.length = 0;
                const ing = ingredients[3];
                ing.floor = FLOOR_COUNT - 1;
                ing.y = FLOOR_YS[FLOOR_COUNT - 1];
                dropIngredient(ing);
                for (let i = 0; i < 120; i++) step(0.016);
                setChef(300, 4);
                spawnEnemy({ x: 300, floor: 4 });
                for (let i = 0; i < 5; i++) step(0.016);
                return { lives, tray: tray[0].length };
            });
            expect(r.lives).toBe(2);
            expect(r.tray).toBe(1);
        });

        test('losing the last life ends the game', async ({ page }) => {
            const s = await page.evaluate(() => {
                startGame(); autoSpawn = false; enemies.length = 0;
                lives = 1;
                setChef(300, 4);
                spawnEnemy({ x: 300, floor: 4 });
                for (let i = 0; i < 5; i++) step(0.016);
                return state;
            });
            expect(s).toBe('over');
        });

        test('a falling ingredient squashes an enemy for bonus points', async ({ page }) => {
            const r = await page.evaluate(() => {
                startGame(); autoSpawn = false; enemies.length = 0;
                setChef(20, 4);
                spawnEnemy({ x: COLUMN_X[0] + ING_W / 2, floor: 1 });
                const before = score;
                dropIngredient(ingredients[0]);
                for (let i = 0; i < 120; i++) step(0.016);
                return { enemies: enemies.length, gained: score - before };
            });
            expect(r.enemies).toBe(0);
            expect(r.gained).toBeGreaterThan(50);
        });

        test('the spawner adds enemies over time when enabled', async ({ page }) => {
            const n = await page.evaluate(() => {
                startGame();
                enemies.length = 0;
                setChef(320, 0);
                for (let i = 0; i < 300; i++) step(0.016);
                return enemies.length;
            });
            expect(n).toBeGreaterThan(0);
        });
    });

    // -----------------------------------------------------------------------
    // Pepper
    // -----------------------------------------------------------------------
    test.describe('pepper', () => {
        test('throwing pepper uses a shaker', async ({ page }) => {
            const r = await page.evaluate(() => {
                startGame(); autoSpawn = false; enemies.length = 0;
                const before = pepperCount;
                const ok = throwPepper();
                return { before, after: pepperCount, ok };
            });
            expect(r.ok).toBe(true);
            expect(r.after).toBe(r.before - 1);
        });

        test('pepper stuns a nearby enemy', async ({ page }) => {
            const stun = await page.evaluate(() => {
                startGame(); autoSpawn = false; enemies.length = 0;
                setChef(300, 4);
                chef.facing = 1;
                spawnEnemy({ x: 300 + PEPPER_REACH, floor: 4 });
                throwPepper();
                step(0.016);
                return enemies.length ? enemies[0].stun : 0;
            });
            expect(stun).toBeGreaterThan(0);
        });

        test('a stunned enemy does not move', async ({ page }) => {
            const r = await page.evaluate(() => {
                startGame(); autoSpawn = false; enemies.length = 0;
                setChef(100, 4);
                spawnEnemy({ x: 500, floor: 4 });
                enemies[0].stun = STUN_TIME;
                const before = enemies[0].x;
                for (let i = 0; i < 20; i++) step(0.016);
                return { before, after: enemies[0].x };
            });
            expect(r.after).toBe(r.before);
        });

        test('a stunned enemy is harmless to touch', async ({ page }) => {
            const r = await page.evaluate(() => {
                startGame(); autoSpawn = false; enemies.length = 0;
                setChef(300, 4);
                spawnEnemy({ x: 300, floor: 4 });
                enemies[0].stun = STUN_TIME;
                for (let i = 0; i < 10; i++) step(0.016);
                return { lives, enemies: enemies.length };
            });
            expect(r.lives).toBe(3);
            expect(r.enemies).toBe(1);
        });

        test('a stun wears off', async ({ page }) => {
            const stun = await page.evaluate(() => {
                startGame(); autoSpawn = false; enemies.length = 0;
                setChef(20, 0);
                spawnEnemy({ x: 500, floor: 4 });
                enemies[0].stun = 0.5;
                for (let i = 0; i < 60; i++) step(0.016);
                return enemies[0].stun;
            });
            expect(stun).toBe(0);
        });

        test('pepper cannot be thrown with an empty shaker', async ({ page }) => {
            const ok = await page.evaluate(() => {
                startGame(); autoSpawn = false; enemies.length = 0;
                pepperCount = 0;
                return throwPepper();
            });
            expect(ok).toBe(false);
        });

        test('Space throws pepper while playing', async ({ page }) => {
            await page.evaluate(() => { startGame(); autoSpawn = false; enemies.length = 0; });
            const before = await page.evaluate(() => pepperCount);
            await page.keyboard.press('Space');
            const after = await page.evaluate(() => pepperCount);
            expect(after).toBe(before - 1);
        });

        test('clearing a level refills the shakers', async ({ page }) => {
            const r = await page.evaluate(() => {
                startGame(); autoSpawn = false; enemies.length = 0;
                pepperCount = 1;
                for (const ing of ingredients.slice()) {
                    ing.floor = FLOOR_COUNT - 1;
                    ing.y = FLOOR_YS[FLOOR_COUNT - 1];
                    dropIngredient(ing);
                    for (let i = 0; i < 90; i++) step(0.016);
                }
                return { pepperCount, level };
            });
            expect(r.level).toBe(2);
            expect(r.pepperCount).toBe(5);
        });
    });

    // -----------------------------------------------------------------------
    // Pause, game over and restart
    // -----------------------------------------------------------------------
    test.describe('pause, game over and restart', () => {
        test('pausing freezes a falling ingredient', async ({ page }) => {
            const r = await page.evaluate(() => {
                startGame(); autoSpawn = false; enemies.length = 0;
                dropIngredient(ingredients[0]);
                togglePause();
                const before = ingredients[0].y;
                for (let i = 0; i < 10; i++) step(0.016);
                return { before, after: ingredients[0].y, state };
            });
            expect(r.state).toBe('paused');
            expect(r.after).toBe(r.before);
        });

        test('resuming lets it fall again', async ({ page }) => {
            const moved = await page.evaluate(() => {
                startGame(); autoSpawn = false; enemies.length = 0;
                dropIngredient(ingredients[0]);
                togglePause();
                togglePause();
                const before = ingredients[0].y;
                for (let i = 0; i < 10; i++) step(0.016);
                return ingredients[0].y > before;
            });
            expect(moved).toBe(true);
        });

        test('best score updates on game over when beaten', async ({ page }) => {
            await page.evaluate(() => {
                startGame();
                score = 2400;
                updateHud();
                endGame();
            });
            await expect(page.locator('#best')).toHaveText('2400');
        });

        test('best score persists to localStorage', async ({ page }) => {
            await page.evaluate(() => {
                startGame();
                score = 1750;
                updateHud();
                endGame();
            });
            const stored = await page.evaluate(() => window.localStorage.getItem('burgertime-best'));
            expect(parseInt(stored, 10)).toBe(1750);
        });

        test('best score is not lowered by a worse run', async ({ page }) => {
            await page.evaluate(() => window.localStorage.setItem('burgertime-best', '9000'));
            await page.reload();
            await page.evaluate(() => { startGame(); score = 10; updateHud(); endGame(); });
            await expect(page.locator('#best')).toHaveText('9000');
        });

        test('game over shows the overlay with Play Again', async ({ page }) => {
            await page.evaluate(() => { startGame(); endGame(); });
            await expect(page.locator('#overlay')).toHaveClass(/visible/);
            await expect(page.locator('#btn-start')).toHaveText('Play Again');
        });

        test('restart resets score, level, lives and the board', async ({ page }) => {
            const r = await page.evaluate(() => {
                startGame();
                score = 4321;
                level = 6;
                lives = 1;
                pepperCount = 0;
                endGame();
                startGame();
                return {
                    score, level, lives, pepperCount, state,
                    ingredients: ingredients.length,
                    inTray: ingredients.filter((i) => i.inTray).length,
                    enemies: enemies.length,
                };
            });
            expect(r.score).toBe(0);
            expect(r.level).toBe(1);
            expect(r.lives).toBe(3);
            expect(r.pepperCount).toBe(5);
            expect(r.state).toBe('running');
            expect(r.ingredients).toBe(16);
            expect(r.inTray).toBe(0);
            expect(r.enemies).toBe(0);
        });

        test('the simulation is frozen once the game is over', async ({ page }) => {
            const r = await page.evaluate(() => {
                startGame(); autoSpawn = false; enemies.length = 0;
                dropIngredient(ingredients[0]);
                endGame();
                const before = ingredients[0].y;
                for (let i = 0; i < 10; i++) step(0.016);
                return { before, after: ingredients[0].y };
            });
            expect(r.after).toBe(r.before);
        });

        test('the HUD shows lives and peppers', async ({ page }) => {
            await page.evaluate(() => { startGame(); lives = 2; pepperCount = 3; updateHud(); });
            await expect(page.locator('#lives')).toHaveText('2');
            await expect(page.locator('#peppers')).toHaveText('3');
        });
    });
});
