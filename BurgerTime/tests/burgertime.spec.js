const { test, expect } = require('@playwright/test');
const path = require('path');
const { pathToFileURL } = require('url');

const GAME_URL = pathToFileURL(path.resolve(__dirname, '../index.html')).href;

/** Start a game and take manual control of the clock. */
async function start(page) {
    await page.evaluate(() => {
        setAutoLoop(false);
        startGame();
    });
}

/**
 * Start a game with the board to yourself. Long movement/stepping runs would
 * otherwise be interrupted by an enemy wandering into the chef.
 */
async function startAlone(page) {
    await page.evaluate(() => {
        setAutoLoop(false);
        startGame();
        enemies.length = 0;
    });
}

test.describe('Burger Time', () => {
    test.beforeEach(async ({ page }) => {
        await page.goto(GAME_URL);
    });

    // -----------------------------------------------------------------------
    // Initial state
    // -----------------------------------------------------------------------
    test.describe('initial state', () => {
        test('page title is Burger Time', async ({ page }) => {
            await expect(page).toHaveTitle('Burger Time');
        });

        test('canvas is 600x500', async ({ page }) => {
            const canvas = page.locator('#canvas');
            await expect(canvas).toHaveAttribute('width', '600');
            await expect(canvas).toHaveAttribute('height', '500');
        });

        test('start overlay is visible and prompts the player', async ({ page }) => {
            await expect(page.locator('#overlay')).toHaveClass(/visible/);
            await expect(page.locator('#overlay-sub')).toContainText(/space|start/i);
        });

        test('HUD starts at zero score, 3 lives, level 1, 5 peppers', async ({ page }) => {
            await expect(page.locator('#score')).toHaveText('0');
            await expect(page.locator('#lives')).toHaveText('3');
            await expect(page.locator('#level')).toHaveText('1');
            await expect(page.locator('#peppers')).toHaveText('5');
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
    // Board layout
    // -----------------------------------------------------------------------
    test.describe('board layout', () => {
        test('there are 6 floors, 5 ladders and 4 burger columns', async ({ page }) => {
            const layout = await page.evaluate(() => ({
                floors: FLOOR_Y.length,
                ladders: LADDER_X.length,
                columns: COLUMN_X.length,
            }));
            expect(layout).toEqual({ floors: 6, ladders: 5, columns: 4 });
        });

        test('every ingredient fits between the ladders that flank its column', async ({ page }) => {
            const ok = await page.evaluate(() =>
                COLUMN_X.every((cx, i) => cx - ING_W / 2 > LADDER_X[i] && cx + ING_W / 2 < LADDER_X[i + 1])
            );
            expect(ok).toBe(true);
        });

        test('16 ingredients: 4 per column, stacked bun/lettuce/patty/bun', async ({ page }) => {
            const info = await page.evaluate(() => {
                startGame();
                return {
                    total: ingredients.length,
                    col0: ingredients
                        .filter((i) => i.col === 0)
                        .sort((a, b) => a.floor - b.floor)
                        .map((i) => [i.kind, i.floor]),
                };
            });
            expect(info.total).toBe(16);
            expect(info.col0).toEqual([
                ['bunTop', 0],
                ['lettuce', 1],
                ['patty', 2],
                ['bunBottom', 3],
            ]);
        });

        test('ingredients rest on their floor and are centred on their column', async ({ page }) => {
            const ok = await page.evaluate(() => {
                startGame();
                return ingredients.every(
                    (i) => i.y === restY(i.floor) && ingX(i) + ING_W / 2 === COLUMN_X[i.col]
                );
            });
            expect(ok).toBe(true);
        });

        test('each ingredient has 4 unstepped segments', async ({ page }) => {
            const ok = await page.evaluate(() => {
                startGame();
                return ingredients.every((i) => i.steps.length === 4 && i.steps.every((s) => s === false));
            });
            expect(ok).toBe(true);
        });
    });

    // -----------------------------------------------------------------------
    // Starting
    // -----------------------------------------------------------------------
    test.describe('starting', () => {
        test('Space starts the game and hides the overlay', async ({ page }) => {
            await page.keyboard.press('Space');
            expect(await page.evaluate(() => state)).toBe('running');
            await expect(page.locator('#overlay')).not.toHaveClass(/visible/);
        });

        test('Enter starts the game', async ({ page }) => {
            await page.keyboard.press('Enter');
            expect(await page.evaluate(() => state)).toBe('running');
        });

        test('the Start button starts the game', async ({ page }) => {
            await page.locator('#btn-start').click();
            expect(await page.evaluate(() => state)).toBe('running');
        });

        test('a fresh game resets score, lives, level and peppers', async ({ page }) => {
            const s = await page.evaluate(() => {
                score = 999;
                lives = 1;
                level = 7;
                peppers = 0;
                startGame();
                return { score, lives, level, peppers };
            });
            expect(s).toEqual({ score: 0, lives: 3, level: 1, peppers: 5 });
        });

        test('the chef spawns standing on the bottom floor', async ({ page }) => {
            const c = await page.evaluate(() => {
                startGame();
                return { floor: chef.floor, y: chef.y, climbing: chef.climbing };
            });
            expect(c.floor).toBe(5);
            expect(c.y).toBe(395);
            expect(c.climbing).toBe(false);
        });

        test('three enemies spawn, alive and inside the board', async ({ page }) => {
            const e = await page.evaluate(() => {
                startGame();
                return enemies.map((x) => ({ dead: x.dead, x: x.x, floor: x.floor }));
            });
            expect(e).toHaveLength(3);
            for (const en of e) {
                expect(en.dead).toBe(false);
                expect(en.x).toBeGreaterThanOrEqual(0);
                expect(en.x).toBeLessThanOrEqual(600);
                expect(en.floor).toBeGreaterThanOrEqual(0);
                expect(en.floor).toBeLessThanOrEqual(5);
            }
        });
    });

    // -----------------------------------------------------------------------
    // Chef movement
    // -----------------------------------------------------------------------
    test.describe('chef movement', () => {
        test('holding right moves the chef right', async ({ page }) => {
            await startAlone(page);
            const moved = await page.evaluate(() => {
                const before = chef.x;
                input.right = true;
                tick(0.2);
                return chef.x - before;
            });
            expect(moved).toBeGreaterThan(0);
        });

        test('holding left moves the chef left and flips his facing', async ({ page }) => {
            await startAlone(page);
            const r = await page.evaluate(() => {
                const before = chef.x;
                input.left = true;
                tick(0.2);
                return { delta: chef.x - before, dir: chef.dir };
            });
            expect(r.delta).toBeLessThan(0);
            expect(r.dir).toBe(-1);
        });

        test('the chef cannot walk off the left or right edge', async ({ page }) => {
            await startAlone(page);
            const bounds = await page.evaluate(() => {
                input.left = true;
                for (let i = 0; i < 200; i++) tick(0.05);
                const minX = chef.x;
                input.left = false;
                input.right = true;
                for (let i = 0; i < 200; i++) tick(0.05);
                return { minX, maxX: chef.x };
            });
            expect(bounds.minX).toBeGreaterThanOrEqual(0);
            expect(bounds.maxX).toBeLessThanOrEqual(600);
        });

        test('the chef cannot climb when he is not on a ladder', async ({ page }) => {
            await startAlone(page);
            const r = await page.evaluate(() => {
                chef.x = 105; // burger column centre, between ladders
                const y = chef.y;
                input.up = true;
                tick(0.3);
                return { y, now: chef.y, climbing: chef.climbing };
            });
            expect(r.now).toBe(r.y);
            expect(r.climbing).toBe(false);
        });

        test('the chef climbs up a ladder and snaps to the floor above', async ({ page }) => {
            await startAlone(page);
            const r = await page.evaluate(() => {
                chef.x = LADDER_X[2] + 3; // within snap range
                input.up = true;
                tick(0.1);
                const mid = { y: chef.y, x: chef.x, climbing: chef.climbing };
                for (let i = 0; i < 60; i++) tick(0.05);
                input.up = false;
                return { mid, floor: chef.floor, y: chef.y, climbing: chef.climbing };
            });
            expect(r.mid.climbing).toBe(true);
            expect(r.mid.x).toBe(300);
            expect(r.mid.y).toBeLessThan(395);
            expect(r.floor).toBe(0);
            expect(r.y).toBe(70);
            expect(r.climbing).toBe(false);
        });

        test('climbing stops at the top floor', async ({ page }) => {
            await startAlone(page);
            const y = await page.evaluate(() => {
                chef.x = LADDER_X[0];
                input.up = true;
                for (let i = 0; i < 200; i++) tick(0.05);
                return chef.y;
            });
            expect(y).toBe(70);
        });

        test('climbing stops at the bottom floor', async ({ page }) => {
            await startAlone(page);
            const y = await page.evaluate(() => {
                chef.x = LADDER_X[0];
                input.down = true;
                for (let i = 0; i < 200; i++) tick(0.05);
                return chef.y;
            });
            expect(y).toBe(395);
        });

        test('the chef cannot walk sideways while climbing between floors', async ({ page }) => {
            await startAlone(page);
            const x = await page.evaluate(() => {
                chef.x = LADDER_X[2];
                input.up = true;
                tick(0.15);
                input.right = true;
                tick(0.1);
                return chef.x;
            });
            expect(x).toBe(300);
        });

        test('stopping just past a floor lets the chef step off the ladder', async ({ page }) => {
            await startAlone(page);
            const r = await page.evaluate(() => {
                chef.x = LADDER_X[2];
                chef.y = FLOOR_Y[3] - 12; // stopped a whisker above floor 3
                chef.floor = 3;
                chef.climbing = true;
                input.right = true;
                tick(0.05);
                return { y: chef.y, climbing: chef.climbing, x: chef.x };
            });
            expect(r.climbing).toBe(false);
            expect(r.y).toBe(265);
            expect(r.x).toBeGreaterThan(300);
        });

        test('arrow keys and WASD both drive the input flags', async ({ page }) => {
            await startAlone(page);
            await page.keyboard.down('ArrowRight');
            expect(await page.evaluate(() => input.right)).toBe(true);
            await page.keyboard.up('ArrowRight');
            expect(await page.evaluate(() => input.right)).toBe(false);
            await page.keyboard.down('KeyW');
            expect(await page.evaluate(() => input.up)).toBe(true);
            await page.keyboard.up('KeyW');
            expect(await page.evaluate(() => input.up)).toBe(false);
        });
    });

    // -----------------------------------------------------------------------
    // Stepping ingredients
    // -----------------------------------------------------------------------
    test.describe('stepping', () => {
        test('standing on a segment steps only that segment', async ({ page }) => {
            await startAlone(page);
            const steps = await page.evaluate(() => {
                const ing = ingredients.find((i) => i.col === 0 && i.floor === 3);
                chef.floor = ing.floor;
                chef.y = FLOOR_Y[ing.floor];
                chef.x = ingX(ing) + SEG_W * 1.5; // middle of segment 1
                tick(0.016);
                return ing.steps.slice();
            });
            expect(steps).toEqual([false, true, false, false]);
        });

        test('a segment is not stepped from a different floor', async ({ page }) => {
            await startAlone(page);
            const steps = await page.evaluate(() => {
                const ing = ingredients.find((i) => i.col === 0 && i.floor === 3);
                chef.floor = 5;
                chef.y = FLOOR_Y[5];
                chef.x = ingX(ing) + SEG_W * 1.5;
                tick(0.016);
                return ing.steps.slice();
            });
            expect(steps).toEqual([false, false, false, false]);
        });

        test('walking the whole ingredient drops it', async ({ page }) => {
            await startAlone(page);
            const r = await page.evaluate(() => {
                const ing = ingredients.find((i) => i.col === 0 && i.floor === 3);
                chef.floor = ing.floor;
                chef.y = FLOOR_Y[ing.floor];
                chef.x = ingX(ing) - 6;
                input.right = true;
                for (let i = 0; i < 40 && !ing.falling; i++) tick(0.05);
                return { falling: ing.falling, score };
            });
            expect(r.falling).toBe(true);
            expect(r.score).toBe(50);
        });

        test('dropping resets the segments so the ingredient can be walked again', async ({ page }) => {
            await startAlone(page);
            const steps = await page.evaluate(() => {
                const ing = ingredients.find((i) => i.col === 0 && i.floor === 3);
                ing.steps = [true, true, true, true];
                tick(0.016);
                return ing.steps.slice();
            });
            expect(steps).toEqual([false, false, false, false]);
        });

        test('an ingredient already falling is not stepped again', async ({ page }) => {
            await startAlone(page);
            const steps = await page.evaluate(() => {
                const ing = ingredients.find((i) => i.col === 0 && i.floor === 3);
                ing.falling = true;
                chef.floor = ing.floor;
                chef.y = FLOOR_Y[ing.floor];
                chef.x = ingX(ing) + SEG_W * 0.5;
                tick(0.016);
                return ing.steps.slice();
            });
            expect(steps).toEqual([false, false, false, false]);
        });
    });

    // -----------------------------------------------------------------------
    // Falling and stacking
    // -----------------------------------------------------------------------
    test.describe('falling ingredients', () => {
        test('a dropped ingredient lands on the next empty floor', async ({ page }) => {
            await start(page);
            const r = await page.evaluate(() => {
                const ing = ingredients.find((i) => i.col === 0 && i.floor === 3);
                dropIngredient(ing);
                for (let i = 0; i < 60 && ing.falling; i++) tick(0.05);
                return { floor: ing.floor, y: ing.y, falling: ing.falling };
            });
            expect(r.falling).toBe(false);
            expect(r.floor).toBe(4);
            expect(r.y).toBe(330 - 12);
        });

        test('landing on an occupied floor knocks the resident loose', async ({ page }) => {
            await start(page);
            const r = await page.evaluate(() => {
                const lower = ingredients.find((i) => i.col === 0 && i.floor === 2);
                lower.floor = 4;
                lower.y = restY(4);
                const upper = ingredients.find((i) => i.col === 0 && i.floor === 3);
                dropIngredient(upper);
                for (let i = 0; i < 60 && upper.falling; i++) tick(0.05);
                return {
                    upperFloor: upper.floor,
                    lowerFalling: lower.falling,
                    lowerTarget: lower.landFloor,
                    score,
                };
            });
            expect(r.upperFloor).toBe(4);
            expect(r.lowerFalling).toBe(true);
            expect(r.lowerTarget).toBe(5);
            expect(r.score).toBe(100); // 50 for the drop + 50 for the knock
        });

        test('an ingredient reaching the bottom lands on the plate', async ({ page }) => {
            await start(page);
            const r = await page.evaluate(() => {
                const ing = ingredients.find((i) => i.col === 0 && i.floor === 3);
                ing.floor = 5;
                ing.y = restY(5);
                dropIngredient(ing);
                for (let i = 0; i < 80 && ing.falling; i++) tick(0.05);
                return { floor: ing.floor, stack: plateStacks[0].length, y: ing.y };
            });
            expect(r.floor).toBe(6);
            expect(r.stack).toBe(1);
            expect(r.y).toBe(455 - 12);
        });

        test('plated ingredients stack on top of each other', async ({ page }) => {
            await start(page);
            const ys = await page.evaluate(() => {
                const col = ingredients.filter((i) => i.col === 1);
                for (const ing of col) {
                    ing.floor = 5;
                    ing.y = restY(5);
                    dropIngredient(ing);
                    for (let i = 0; i < 80 && ing.falling; i++) tick(0.05);
                }
                return plateStacks[1].map((i) => i.y);
            });
            expect(ys).toEqual([455 - 12, 455 - 24, 455 - 36, 455 - 48]);
        });

        test('completing a burger scores a bonus', async ({ page }) => {
            await start(page);
            const s = await page.evaluate(() => {
                const col = ingredients.filter((i) => i.col === 1);
                for (const ing of col) {
                    ing.floor = 5;
                    ing.y = restY(5);
                    dropIngredient(ing);
                    for (let i = 0; i < 80 && ing.falling; i++) tick(0.05);
                }
                return score;
            });
            expect(s).toBe(4 * 50 + 1000);
        });
    });

    // -----------------------------------------------------------------------
    // Enemies
    // -----------------------------------------------------------------------
    test.describe('enemies', () => {
        test('an enemy under a falling ingredient is squashed for points', async ({ page }) => {
            await start(page);
            const r = await page.evaluate(() => {
                const ing = ingredients.find((i) => i.col === 0 && i.floor === 3);
                const e = enemies[0];
                e.x = COLUMN_X[0];
                e.y = FLOOR_Y[4];
                e.floor = 4;
                score = 0;
                dropIngredient(ing);
                for (let i = 0; i < 60 && ing.falling; i++) tick(0.02);
                return { dead: e.dead, score };
            });
            expect(r.dead).toBe(true);
            expect(r.score).toBe(50 + 500);
        });

        test('a second enemy caught by the same ingredient is worth double', async ({ page }) => {
            await start(page);
            const s = await page.evaluate(() => {
                const ing = ingredients.find((i) => i.col === 0 && i.floor === 3);
                for (const e of enemies.slice(0, 2)) {
                    e.x = COLUMN_X[0];
                    e.y = FLOOR_Y[4];
                    e.floor = 4;
                }
                score = 0;
                dropIngredient(ing);
                for (let i = 0; i < 60 && ing.falling; i++) tick(0.02);
                return score;
            });
            expect(s).toBe(50 + 500 + 1000);
        });

        test('a squashed enemy comes back after a delay', async ({ page }) => {
            await start(page);
            const r = await page.evaluate(() => {
                const e = enemies[0];
                squashEnemy(e, null);
                const wasDead = e.dead;
                for (let i = 0; i < 200; i++) tick(0.05);
                return { wasDead, dead: e.dead };
            });
            expect(r.wasDead).toBe(true);
            expect(r.dead).toBe(false);
        });

        test('enemies enter one at a time instead of swarming', async ({ page }) => {
            await start(page);
            const waits = await page.evaluate(() => enemies.map((e) => e.waitTimer));
            expect(waits[0]).toBe(0);
            for (let i = 1; i < waits.length; i++) expect(waits[i]).toBeGreaterThan(waits[i - 1]);
        });

        test('a waiting enemy holds still until its turn', async ({ page }) => {
            await start(page);
            const r = await page.evaluate(() => {
                const e = enemies[1];
                e.x = 100;
                e.y = FLOOR_Y[5];
                e.floor = 5;
                chef.x = 500;
                chef.y = FLOOR_Y[5];
                chef.floor = 5;
                const start = e.x;
                for (let i = 0; i < 10; i++) tick(0.05); // still inside its wait
                const held = e.x - start;
                for (let i = 0; i < 60; i++) tick(0.05);
                return { held, moved: e.x - start };
            });
            expect(r.held).toBe(0);
            expect(r.moved).toBeGreaterThan(0);
        });

        test('enemies chase the chef along a floor', async ({ page }) => {
            await start(page);
            const r = await page.evaluate(() => {
                const e = enemies[0];
                e.x = 100;
                e.y = FLOOR_Y[5];
                e.floor = 5;
                e.climbing = false;
                chef.x = 500;
                chef.y = FLOOR_Y[5];
                chef.floor = 5;
                const before = e.x;
                for (let i = 0; i < 10; i++) tick(0.05);
                return e.x - before;
            });
            expect(r).toBeGreaterThan(0);
        });

        test('a stunned enemy does not move', async ({ page }) => {
            await start(page);
            const moved = await page.evaluate(() => {
                const e = enemies[0];
                e.x = 100;
                e.y = FLOOR_Y[5];
                e.floor = 5;
                e.stunTimer = 4;
                chef.x = 500;
                chef.floor = 5;
                chef.y = FLOOR_Y[5];
                const before = e.x;
                for (let i = 0; i < 10; i++) tick(0.05);
                return e.x - before;
            });
            expect(moved).toBe(0);
        });

        test('touching an enemy costs a life', async ({ page }) => {
            await start(page);
            const r = await page.evaluate(() => {
                const e = enemies[0];
                e.x = chef.x;
                e.y = chef.y;
                e.floor = chef.floor;
                tick(0.016);
                return { lives, state };
            });
            expect(r.lives).toBe(2);
            expect(r.state).toBe('dying');
        });

        test('after dying the chef and enemies return to their spawns', async ({ page }) => {
            await start(page);
            const r = await page.evaluate(() => {
                chef.x = 500;
                const e = enemies[0];
                e.x = chef.x;
                e.y = chef.y;
                e.floor = chef.floor;
                tick(0.016);
                for (let i = 0; i < 60; i++) tick(0.05);
                return { state, chefX: chef.x, chefFloor: chef.floor };
            });
            expect(r.state).toBe('running');
            expect(r.chefX).toBe(300);
            expect(r.chefFloor).toBe(5);
        });

        test('losing the last life ends the game', async ({ page }) => {
            await start(page);
            const s = await page.evaluate(() => {
                lives = 1;
                const e = enemies[0];
                e.x = chef.x;
                e.y = chef.y;
                e.floor = chef.floor;
                tick(0.016);
                for (let i = 0; i < 60; i++) tick(0.05);
                return state;
            });
            expect(s).toBe('gameover');
            await expect(page.locator('#overlay')).toHaveClass(/visible/);
            await expect(page.locator('#overlay-title')).toContainText(/game over/i);
        });

        test('a falling ingredient does not hurt the chef', async ({ page }) => {
            await start(page);
            const lives = await page.evaluate(() => {
                const ing = ingredients.find((i) => i.col === 0 && i.floor === 3);
                chef.x = COLUMN_X[0];
                chef.y = FLOOR_Y[4];
                chef.floor = 4;
                dropIngredient(ing);
                for (let i = 0; i < 60 && ing.falling; i++) tick(0.02);
                return window.lives;
            });
            expect(lives).toBe(3);
        });
    });

    // -----------------------------------------------------------------------
    // Pepper
    // -----------------------------------------------------------------------
    test.describe('pepper', () => {
        test('throwing pepper spends one and shows a cloud', async ({ page }) => {
            await start(page);
            const r = await page.evaluate(() => {
                const ok = firePepper();
                return { ok, peppers, active: pepper.active };
            });
            expect(r.ok).toBe(true);
            expect(r.peppers).toBe(4);
            expect(r.active).toBe(true);
            await expect(page.locator('#peppers')).toHaveText('4');
        });

        test('the cloud lands in front of the chef', async ({ page }) => {
            await start(page);
            const r = await page.evaluate(() => {
                chef.dir = 1;
                firePepper();
                const right = pepper.x > chef.x;
                chef.dir = -1;
                peppers = 5;
                firePepper();
                return { right, left: pepper.x < chef.x };
            });
            expect(r.right).toBe(true);
            expect(r.left).toBe(true);
        });

        test('pepper stuns an enemy caught in the cloud', async ({ page }) => {
            await start(page);
            const stun = await page.evaluate(() => {
                const e = enemies[0];
                e.x = chef.x + 20;
                e.y = chef.y;
                e.floor = chef.floor;
                chef.dir = 1;
                firePepper();
                tick(0.016);
                return e.stunTimer;
            });
            expect(stun).toBeGreaterThan(0);
        });

        test('a stunned enemy recovers', async ({ page }) => {
            await start(page);
            const stun = await page.evaluate(() => {
                const e = enemies[0];
                e.stunTimer = 4;
                for (let i = 0; i < 200; i++) tick(0.05);
                return e.stunTimer;
            });
            expect(stun).toBe(0);
        });

        test('the cloud fades away', async ({ page }) => {
            await start(page);
            const active = await page.evaluate(() => {
                firePepper();
                for (let i = 0; i < 60; i++) tick(0.05);
                return pepper.active;
            });
            expect(active).toBe(false);
        });

        test('pepper cannot be thrown with an empty shaker', async ({ page }) => {
            await start(page);
            const r = await page.evaluate(() => {
                peppers = 0;
                return { ok: firePepper(), peppers };
            });
            expect(r.ok).toBe(false);
            expect(r.peppers).toBe(0);
        });

        test('Space throws pepper while the game is running', async ({ page }) => {
            await page.locator('#btn-start').click();
            await page.evaluate(() => setAutoLoop(false));
            await page.keyboard.press('Space');
            expect(await page.evaluate(() => peppers)).toBe(4);
        });
    });

    // -----------------------------------------------------------------------
    // Pausing
    // -----------------------------------------------------------------------
    test.describe('pausing', () => {
        test('P pauses and resumes', async ({ page }) => {
            await start(page);
            await page.keyboard.press('KeyP');
            expect(await page.evaluate(() => state)).toBe('paused');
            await page.keyboard.press('KeyP');
            expect(await page.evaluate(() => state)).toBe('running');
        });

        test('nothing moves while paused', async ({ page }) => {
            await start(page);
            const moved = await page.evaluate(() => {
                state = 'paused';
                input.right = true;
                const before = chef.x;
                for (let i = 0; i < 10; i++) tick(0.05);
                return chef.x - before;
            });
            expect(moved).toBe(0);
        });

        test('pausing shows the overlay', async ({ page }) => {
            await start(page);
            await page.keyboard.press('KeyP');
            await expect(page.locator('#overlay')).toHaveClass(/visible/);
            await expect(page.locator('#overlay-title')).toContainText(/paused/i);
        });
    });

    // -----------------------------------------------------------------------
    // Level progression
    // -----------------------------------------------------------------------
    test.describe('levels', () => {
        test('plating every ingredient clears the level', async ({ page }) => {
            await start(page);
            const s = await page.evaluate(() => {
                plateAllForTest();
                tick(0.016);
                return state;
            });
            expect(s).toBe('levelclear');
        });

        test('clearing a level rebuilds the burgers and refills the pepper', async ({ page }) => {
            await start(page);
            const r = await page.evaluate(() => {
                peppers = 1;
                plateAllForTest();
                tick(0.016);
                for (let i = 0; i < 120; i++) tick(0.05);
                return {
                    state,
                    level,
                    peppers,
                    plated: ingredients.filter((i) => i.floor === PLATE_FLOOR).length,
                    stacks: plateStacks.map((s) => s.length),
                };
            });
            expect(r.state).toBe('running');
            expect(r.level).toBe(2);
            expect(r.peppers).toBe(5);
            expect(r.plated).toBe(0);
            expect(r.stacks).toEqual([0, 0, 0, 0]);
        });

        test('clearing a level awards a bonus and keeps the score', async ({ page }) => {
            await start(page);
            const s = await page.evaluate(() => {
                plateAllForTest();
                score = 0;
                tick(0.016);
                for (let i = 0; i < 120; i++) tick(0.05);
                return score;
            });
            expect(s).toBe(1000);
        });

        test('enemies get faster on later levels', async ({ page }) => {
            await start(page);
            const r = await page.evaluate(() => {
                const first = enemies[0].speed;
                plateAllForTest();
                tick(0.016);
                for (let i = 0; i < 120; i++) tick(0.05);
                return { first, second: enemies[0].speed };
            });
            expect(r.second).toBeGreaterThan(r.first);
        });
    });

    // -----------------------------------------------------------------------
    // HUD and persistence
    // -----------------------------------------------------------------------
    test.describe('HUD', () => {
        test('the score readout follows the model', async ({ page }) => {
            await start(page);
            await page.evaluate(() => {
                const ing = ingredients.find((i) => i.col === 2 && i.floor === 3);
                dropIngredient(ing);
                tick(0.016);
            });
            await expect(page.locator('#score')).toHaveText('50');
        });

        test('the lives readout follows the model', async ({ page }) => {
            await start(page);
            await page.evaluate(() => {
                const e = enemies[0];
                e.x = chef.x;
                e.y = chef.y;
                e.floor = chef.floor;
                tick(0.016);
            });
            await expect(page.locator('#lives')).toHaveText('2');
        });

        test('a new high score is saved to localStorage', async ({ page }) => {
            await start(page);
            const best = await page.evaluate(() => {
                lives = 1;
                score = 7654;
                const e = enemies[0];
                e.x = chef.x;
                e.y = chef.y;
                e.floor = chef.floor;
                tick(0.016);
                for (let i = 0; i < 60; i++) tick(0.05);
                return window.localStorage.getItem('burgertime-best');
            });
            expect(best).toBe('7654');
            await expect(page.locator('#best')).toHaveText('7654');
        });

        test('a lower score does not replace the best', async ({ page }) => {
            await page.evaluate(() => window.localStorage.setItem('burgertime-best', '9000'));
            await page.reload();
            await start(page);
            const best = await page.evaluate(() => {
                lives = 1;
                score = 10;
                const e = enemies[0];
                e.x = chef.x;
                e.y = chef.y;
                e.floor = chef.floor;
                tick(0.016);
                for (let i = 0; i < 60; i++) tick(0.05);
                return window.localStorage.getItem('burgertime-best');
            });
            expect(best).toBe('9000');
        });

        test('the game can be restarted after game over', async ({ page }) => {
            await start(page);
            await page.evaluate(() => {
                lives = 1;
                const e = enemies[0];
                e.x = chef.x;
                e.y = chef.y;
                e.floor = chef.floor;
                tick(0.016);
                for (let i = 0; i < 60; i++) tick(0.05);
            });
            expect(await page.evaluate(() => state)).toBe('gameover');
            await page.keyboard.press('Space');
            const r = await page.evaluate(() => ({ state, lives, score }));
            expect(r).toEqual({ state: 'running', lives: 3, score: 0 });
        });
    });

    // -----------------------------------------------------------------------
    // Rendering smoke test
    // -----------------------------------------------------------------------
    test.describe('rendering', () => {
        test('the canvas is painted', async ({ page }) => {
            await start(page);
            const painted = await page.evaluate(() => {
                draw();
                const ctx = document.getElementById('canvas').getContext('2d');
                const data = ctx.getImageData(0, 0, 600, 500).data;
                for (let i = 0; i < data.length; i += 4) {
                    if (data[i] !== 0 || data[i + 1] !== 0 || data[i + 2] !== 0) return true;
                }
                return false;
            });
            expect(painted).toBe(true);
        });

        test('no console errors during play', async ({ page }) => {
            const errors = [];
            page.on('pageerror', (e) => errors.push(e.message));
            await page.goto(GAME_URL);
            await page.locator('#btn-start').click();
            await page.keyboard.down('ArrowRight');
            await page.waitForTimeout(600);
            await page.keyboard.up('ArrowRight');
            await page.keyboard.press('Space');
            await page.waitForTimeout(400);
            expect(errors).toEqual([]);
        });
    });
});
