const { test, expect } = require('@playwright/test');
const path = require('path');
const { pathToFileURL } = require('url');

const GAME_URL = pathToFileURL(path.resolve(__dirname, '../index.html')).href;

/** Advance the deterministic simulation by `seconds` of game time. */
async function advance(page, seconds, dt = 1 / 60) {
    await page.evaluate(([s, d]) => {
        const frames = Math.round(s / d);
        for (let i = 0; i < frames; i++) step(d);
    }, [seconds, dt]);
}

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

        test('canvas is 640x560', async ({ page }) => {
            const canvas = page.locator('#canvas');
            await expect(canvas).toHaveAttribute('width', '640');
            await expect(canvas).toHaveAttribute('height', '560');
        });

        test('start overlay is visible and prompts the player', async ({ page }) => {
            await expect(page.locator('#overlay')).toHaveClass(/visible/);
            await expect(page.locator('#overlay-sub')).toContainText(/enter|start/i);
        });

        test('state is idle before starting', async ({ page }) => {
            expect(await page.evaluate(() => state)).toBe('idle');
        });

        test('HUD starts at zero score and level 1', async ({ page }) => {
            await expect(page.locator('#score')).toHaveText('0');
            await expect(page.locator('#level')).toHaveText('1');
            await expect(page.locator('#best')).toHaveText('0');
        });

        test('best score loads from localStorage', async ({ page }) => {
            await page.evaluate(() => window.localStorage.setItem('burgertime-best', '31500'));
            await page.reload();
            await expect(page.locator('#best')).toHaveText('31500');
        });

        test('there are 16 ingredients, 4 per column', async ({ page }) => {
            const counts = await page.evaluate(() => {
                const per = [0, 0, 0, 0];
                ingredients.forEach((i) => per[i.col]++);
                return { total: ingredients.length, per };
            });
            expect(counts.total).toBe(16);
            expect(counts.per).toEqual([4, 4, 4, 4]);
        });

        test('no ingredient starts on a plate', async ({ page }) => {
            expect(await page.evaluate(() => ingredients.some((i) => i.onPlate))).toBe(false);
        });

        test('every column starts with one of each ingredient type', async ({ page }) => {
            const ok = await page.evaluate(() =>
                [0, 1, 2, 3].every((c) => {
                    const types = ingredients.filter((i) => i.col === c).map((i) => i.type).sort();
                    return types.join(',') === ['bottomBun', 'lettuce', 'patty', 'topBun'].sort().join(',');
                })
            );
            expect(ok).toBe(true);
        });

        test('ingredients in a column start on distinct floors, lower pieces lower down', async ({ page }) => {
            const ok = await page.evaluate(() => {
                const order = ['topBun', 'lettuce', 'patty', 'bottomBun'];
                return [0, 1, 2, 3].every((c) => {
                    const col = ingredients.filter((i) => i.col === c);
                    const floors = col.map((i) => i.floor);
                    if (new Set(floors).size !== 4) return false;
                    const byOrder = order.map((t) => col.find((i) => i.type === t).floor);
                    return byOrder.every((f, k) => k === 0 || f > byOrder[k - 1]);
                });
            });
            expect(ok).toBe(true);
        });

        test('ingredients rest exactly on their floor', async ({ page }) => {
            const ok = await page.evaluate(() =>
                ingredients.every((i) => Math.abs(i.y - (FLOOR_Y[i.floor] - ING_H)) < 0.001)
            );
            expect(ok).toBe(true);
        });

        test('no monsters before starting', async ({ page }) => {
            expect(await page.evaluate(() => monsters.length)).toBe(0);
        });
    });

    // -----------------------------------------------------------------------
    // Starting a run
    // -----------------------------------------------------------------------
    test.describe('starting', () => {
        test('Enter starts the game', async ({ page }) => {
            await page.keyboard.press('Enter');
            expect(await page.evaluate(() => state)).toBe('running');
            await expect(page.locator('#overlay')).not.toHaveClass(/visible/);
        });

        test('Start button starts the game', async ({ page }) => {
            await page.locator('#btn-start').click();
            expect(await page.evaluate(() => state)).toBe('running');
        });

        test('a run begins on level 1 with full lives and pepper', async ({ page }) => {
            const s = await page.evaluate(() => {
                startGame();
                return { level, lives, pepper, score, startLives: START_LIVES };
            });
            expect(s.level).toBe(1);
            expect(s.lives).toBe(s.startLives);
            expect(s.startLives).toBe(3);
            expect(s.pepper).toBe(5);
            expect(s.score).toBe(0);
        });

        test('the chef starts on the bottom floor inside the canvas', async ({ page }) => {
            const c = await page.evaluate(() => {
                startGame();
                return { x: chef.x, y: chef.y, floor: chef.floor, bottom: FLOOR_Y.length - 1 };
            });
            expect(c.floor).toBe(c.bottom);
            expect(c.x).toBeGreaterThan(0);
            expect(c.x).toBeLessThan(640);
        });
    });

    // -----------------------------------------------------------------------
    // Chef movement
    // -----------------------------------------------------------------------
    test.describe('chef movement', () => {
        // Navigation only: hold the spawner off so a monster cannot reset the
        // chef mid-walk and invalidate a position assertion.
        test.beforeEach(async ({ page }) => {
            await page.evaluate(() => { startGame(); spawnTimer = Infinity; });
        });

        test('holding right walks the chef right', async ({ page }) => {
            const before = await page.evaluate(() => chef.x);
            await page.keyboard.down('ArrowRight');
            await advance(page, 0.5);
            expect(await page.evaluate(() => chef.x)).toBeGreaterThan(before);
        });

        test('holding left walks the chef left', async ({ page }) => {
            const before = await page.evaluate(() => chef.x);
            await page.keyboard.down('ArrowLeft');
            await advance(page, 0.5);
            expect(await page.evaluate(() => chef.x)).toBeLessThan(before);
        });

        test('walking sets the facing direction', async ({ page }) => {
            await page.keyboard.down('ArrowLeft');
            await advance(page, 0.2);
            expect(await page.evaluate(() => chef.dir)).toBe(-1);
            await page.keyboard.up('ArrowLeft');
            await page.keyboard.down('ArrowRight');
            await advance(page, 0.2);
            expect(await page.evaluate(() => chef.dir)).toBe(1);
        });

        test('the chef cannot walk off the left or right edge', async ({ page }) => {
            await page.keyboard.down('ArrowLeft');
            await advance(page, 12);
            const left = await page.evaluate(() => chef.x);
            expect(left).toBeGreaterThanOrEqual(0);
            await page.keyboard.up('ArrowLeft');
            await page.keyboard.down('ArrowRight');
            await advance(page, 20);
            const right = await page.evaluate(() => chef.x);
            expect(right).toBeLessThanOrEqual(640);
        });

        test('pressing up away from a ladder does not lift the chef', async ({ page }) => {
            const y = await page.evaluate(() => {
                // Park the chef between two ladders.
                chef.x = (LADDERS[0].x + LADDERS[1].x) / 2;
                return chef.y;
            });
            await page.keyboard.down('ArrowUp');
            await advance(page, 0.5);
            expect(await page.evaluate(() => chef.y)).toBe(y);
        });

        test('pressing up on a ladder climbs and snaps the chef to the ladder', async ({ page }) => {
            await page.evaluate(() => { chef.x = LADDERS[0].x + 4; });
            const y0 = await page.evaluate(() => chef.y);
            await page.keyboard.down('ArrowUp');
            await advance(page, 0.5);
            const c = await page.evaluate(() => ({ x: chef.x, y: chef.y }));
            expect(c.y).toBeLessThan(y0);
            expect(c.x).toBeCloseTo(await page.evaluate(() => LADDERS[0].x), 3);
        });

        test('climbing a full floor snaps onto the floor above', async ({ page }) => {
            const c = await page.evaluate(() => {
                const from = chef.floor;
                chef.x = LADDERS[0].x;
                input.up = true;
                let guard = 0;
                while (chef.floor !== from - 1 && guard++ < 600) step(1 / 60);
                input.up = false;
                return { from, floor: chef.floor, y: chef.y, floorY: FLOOR_Y[chef.floor] };
            });
            expect(c.floor).toBe(c.from - 1);
            expect(c.y).toBe(c.floorY);
        });

        test('the chef is mid-ladder between floors while climbing', async ({ page }) => {
            const c = await page.evaluate(() => {
                chef.x = LADDERS[0].x;
                input.up = true;
                for (let i = 0; i < 20; i++) step(1 / 60);
                input.up = false;
                return { floor: chef.floor, y: chef.y, bottomY: FLOOR_Y[FLOOR_Y.length - 1] };
            });
            expect(c.floor).toBe(-1);
            expect(c.y).toBeLessThan(c.bottomY);
        });

        test('the chef cannot climb above the top floor', async ({ page }) => {
            await page.evaluate(() => { chef.x = LADDERS[0].x; });
            await page.keyboard.down('ArrowUp');
            await advance(page, 30);
            expect(await page.evaluate(() => chef.floor)).toBe(0);
            expect(await page.evaluate(() => chef.y)).toBe(await page.evaluate(() => FLOOR_Y[0]));
        });

        test('the chef cannot climb below the bottom floor', async ({ page }) => {
            await page.evaluate(() => { chef.x = LADDERS[0].x; });
            await page.keyboard.down('ArrowDown');
            await advance(page, 5);
            const bottom = await page.evaluate(() => FLOOR_Y.length - 1);
            expect(await page.evaluate(() => chef.floor)).toBe(bottom);
        });

        test('gap ladders do not reach the top floor', async ({ page }) => {
            const res = await page.evaluate(() => {
                const gap = LADDERS.find((l) => l.top === 1);
                chef.x = gap.x;
                chef.floor = 1;
                chef.y = FLOOR_Y[1];
                input.up = true;
                for (let i = 0; i < 600; i++) step(1 / 60);
                input.up = false;
                return { floor: chef.floor, gapX: gap.x };
            });
            expect(res.floor).toBe(1);
        });

        test('the chef cannot walk while mid-ladder', async ({ page }) => {
            const x = await page.evaluate(() => {
                chef.x = LADDERS[0].x;
                input.up = true;
                for (let i = 0; i < 20; i++) step(1 / 60);
                input.up = false;
                return chef.x;
            });
            await page.keyboard.down('ArrowRight');
            await advance(page, 0.5);
            expect(await page.evaluate(() => chef.x)).toBe(x);
        });
    });

    // -----------------------------------------------------------------------
    // Walking ingredients down
    // -----------------------------------------------------------------------
    test.describe('ingredients', () => {
        // Physics only: hold the monster spawner off so nothing interrupts a drop.
        test.beforeEach(async ({ page }) => {
            await page.evaluate(() => { startGame(); spawnTimer = Infinity; });
        });

        test('walking over a segment marks only that segment', async ({ page }) => {
            const stepped = await page.evaluate(() => {
                const ing = ingredients.find((i) => !i.falling);
                chef.floor = ing.floor;
                chef.y = FLOOR_Y[ing.floor];
                chef.x = ing.x + SEG_W * 0.5;
                step(1 / 60);
                return ing.stepped.slice();
            });
            expect(stepped).toEqual([true, false, false, false]);
        });

        test('walking all four segments drops the ingredient', async ({ page }) => {
            const res = await page.evaluate(() => {
                const ing = ingredients[0];
                chef.floor = ing.floor;
                chef.y = FLOOR_Y[ing.floor];
                for (let s = 0; s < 4; s++) {
                    chef.x = ing.x + SEG_W * (s + 0.5);
                    step(1 / 60);
                }
                return { falling: ing.falling, stepped: ing.stepped.slice() };
            });
            expect(res.falling).toBe(true);
        });

        test('three of four segments is not enough', async ({ page }) => {
            const falling = await page.evaluate(() => {
                const ing = ingredients[0];
                chef.floor = ing.floor;
                chef.y = FLOOR_Y[ing.floor];
                for (let s = 0; s < 3; s++) {
                    chef.x = ing.x + SEG_W * (s + 0.5);
                    step(1 / 60);
                }
                return ing.falling;
            });
            expect(falling).toBe(false);
        });

        test('an ingredient on another floor is not stepped', async ({ page }) => {
            const stepped = await page.evaluate(() => {
                const ing = ingredients.find((i) => i.floor > 0);
                chef.floor = ing.floor - 1;
                chef.y = FLOOR_Y[chef.floor];
                chef.x = ing.x + SEG_W * 0.5;
                step(1 / 60);
                return ing.stepped.some(Boolean);
            });
            expect(stepped).toBe(false);
        });

        test('a dropped ingredient lands on the floor below and resets its segments', async ({ page }) => {
            const res = await page.evaluate(() => {
                // Pick an ingredient with an empty floor beneath it in its column.
                const ing = ingredients.find(
                    (i) => i.floor + 1 < FLOOR_Y.length &&
                        !ingredients.some((o) => o !== i && o.col === i.col && o.floor === i.floor + 1)
                );
                const from = ing.floor;
                dropIngredient(ing);
                for (let i = 0; i < 600; i++) step(1 / 60);
                return {
                    from,
                    to: ing.floor,
                    falling: ing.falling,
                    stepped: ing.stepped.some(Boolean),
                    y: ing.y,
                    restY: FLOOR_Y[ing.floor] - ING_H,
                };
            });
            expect(res.to).toBe(res.from + 1);
            expect(res.falling).toBe(false);
            expect(res.stepped).toBe(false);
            expect(res.y).toBeCloseTo(res.restY, 3);
        });

        test('dropping onto a resting ingredient knocks it loose too', async ({ page }) => {
            const res = await page.evaluate(() => {
                // Build a guaranteed stack: two pieces of one column on adjacent floors.
                const col = ingredients.filter((i) => i.col === 0).sort((a, b) => a.floor - b.floor);
                const upper = col[0], lower = col[1];
                lower.floor = upper.floor + 1;
                lower.y = FLOOR_Y[lower.floor] - ING_H;
                const startFloor = lower.floor;
                dropIngredient(upper);
                for (let i = 0; i < 60; i++) step(1 / 60);
                return { lowerMoved: lower.falling || lower.floor > startFloor };
            });
            expect(res.lowerMoved).toBe(true);
        });

        test('an ingredient dropped from the bottom floor lands on the plate', async ({ page }) => {
            const res = await page.evaluate(() => {
                const ing = ingredients[0];
                ing.floor = FLOOR_Y.length - 1;
                ing.y = FLOOR_Y[ing.floor] - ING_H;
                dropIngredient(ing);
                for (let i = 0; i < 600; i++) step(1 / 60);
                return { onPlate: ing.onPlate, falling: ing.falling, y: ing.y };
            });
            expect(res.onPlate).toBe(true);
            expect(res.falling).toBe(false);
            expect(res.y).toBeLessThan(560);
        });

        test('plated ingredients stack upward in arrival order', async ({ page }) => {
            const ys = await page.evaluate(() => {
                const col = ingredients.filter((i) => i.col === 1);
                const out = [];
                for (const ing of col.slice(0, 3)) {
                    ing.floor = FLOOR_Y.length - 1;
                    ing.y = FLOOR_Y[ing.floor] - ING_H;
                    dropIngredient(ing);
                    for (let i = 0; i < 600; i++) step(1 / 60);
                    out.push(ing.y);
                }
                return out;
            });
            expect(ys[1]).toBeLessThan(ys[0]);
            expect(ys[2]).toBeLessThan(ys[1]);
        });

        test('dropping an ingredient scores points', async ({ page }) => {
            const res = await page.evaluate(() => {
                const before = score;
                dropIngredient(ingredients[0]);
                for (let i = 0; i < 600; i++) step(1 / 60);
                return { before, after: score };
            });
            expect(res.after).toBeGreaterThan(res.before);
        });

        test('the chef rides an ingredient he is standing on', async ({ page }) => {
            const res = await page.evaluate(() => {
                const ing = ingredients.find(
                    (i) => i.floor + 1 < FLOOR_Y.length &&
                        !ingredients.some((o) => o !== i && o.col === i.col && o.floor === i.floor + 1)
                );
                chef.floor = ing.floor;
                chef.y = FLOOR_Y[ing.floor];
                chef.x = ing.x + ING_W / 2;
                const from = chef.floor;
                dropIngredient(ing);
                for (let i = 0; i < 600; i++) step(1 / 60);
                return { from, to: chef.floor, y: chef.y, floorY: FLOOR_Y[chef.floor] };
            });
            expect(res.to).toBe(res.from + 1);
            expect(res.y).toBeCloseTo(res.floorY, 3);
        });

        test('a falling ingredient never passes through the plate', async ({ page }) => {
            const ok = await page.evaluate(() => {
                ingredients.forEach((i) => dropIngredient(i));
                for (let i = 0; i < 2000; i++) step(1 / 60);
                return ingredients.every((i) => i.y < PLATE_Y && !i.falling);
            });
            expect(ok).toBe(true);
        });
    });

    // -----------------------------------------------------------------------
    // Monsters
    // -----------------------------------------------------------------------
    test.describe('monsters', () => {
        // Monsters are placed by hand in most of these, so the spawner is held
        // off; the two spawn-timer tests re-enable it by restarting.
        test.beforeEach(async ({ page }) => {
            await page.evaluate(() => { startGame(); spawnTimer = Infinity; });
        });

        test('monsters appear once the spawn timer elapses', async ({ page }) => {
            await page.evaluate(() => startGame());
            await advance(page, 8);
            expect(await page.evaluate(() => monsters.length)).toBeGreaterThan(0);
        });

        test('the monster count is capped', async ({ page }) => {
            await page.evaluate(() => startGame());
            await advance(page, 90);
            const res = await page.evaluate(() => ({ n: monsters.length, cap: maxMonsters() }));
            expect(res.n).toBeLessThanOrEqual(res.cap);
        });

        test('a monster on the chef floor walks toward the chef', async ({ page }) => {
            const res = await page.evaluate(() => {
                const m = spawnMonster();
                m.floor = chef.floor;
                m.y = FLOOR_Y[m.floor];
                m.x = 40;
                chef.x = 600;
                const before = m.x;
                for (let i = 0; i < 30; i++) step(1 / 60);
                return { before, after: m.x };
            });
            expect(res.after).toBeGreaterThan(res.before);
        });

        test('a monster above the chef comes down a ladder', async ({ page }) => {
            const res = await page.evaluate(() => {
                const m = spawnMonster();
                m.floor = 0;
                m.y = FLOOR_Y[0];
                m.x = LADDERS[0].x;
                chef.floor = FLOOR_Y.length - 1;
                chef.y = FLOOR_Y[chef.floor];
                chef.x = LADDERS[0].x;
                const before = m.y;
                for (let i = 0; i < 240; i++) step(1 / 60);
                return { before, after: m.y };
            });
            expect(res.after).toBeGreaterThan(res.before);
        });

        test('touching a monster costs a life and resets the chef', async ({ page }) => {
            const res = await page.evaluate(() => {
                const lives0 = lives;
                const m = spawnMonster();
                m.floor = chef.floor;
                m.y = chef.y;
                m.x = chef.x;
                step(1 / 60);
                return { lives0, lives1: lives, monsters: monsters.length };
            });
            expect(res.lives1).toBe(res.lives0 - 1);
            expect(res.monsters).toBe(0);
        });

        test('a frozen monster is harmless', async ({ page }) => {
            const res = await page.evaluate(() => {
                const lives0 = lives;
                const m = spawnMonster();
                m.floor = chef.floor;
                m.y = chef.y;
                m.x = chef.x;
                m.stun = 3;
                for (let i = 0; i < 30; i++) step(1 / 60);
                return { lives0, lives1: lives };
            });
            expect(res.lives1).toBe(res.lives0);
        });

        test('a frozen monster does not move', async ({ page }) => {
            const res = await page.evaluate(() => {
                const m = spawnMonster();
                m.floor = chef.floor;
                m.y = FLOOR_Y[m.floor];
                m.x = 40;
                chef.x = 600;
                m.stun = 3;
                const before = m.x;
                for (let i = 0; i < 60; i++) step(1 / 60);
                return { before, after: m.x };
            });
            expect(res.after).toBe(res.before);
        });

        test('a falling ingredient squashes a monster and scores', async ({ page }) => {
            const res = await page.evaluate(() => {
                const ing = ingredients.find(
                    (i) => i.floor + 1 < FLOOR_Y.length &&
                        !ingredients.some((o) => o !== i && o.col === i.col && o.floor === i.floor + 1)
                );
                const m = spawnMonster();
                m.floor = ing.floor;
                m.y = FLOOR_Y[ing.floor];
                m.x = ing.x + ING_W / 2;
                const before = score;
                const n0 = monsters.length;
                dropIngredient(ing);
                for (let i = 0; i < 600; i++) step(1 / 60);
                return { before, after: score, n0, n1: monsters.length, lives };
            });
            expect(res.n1).toBe(res.n0 - 1);
            expect(res.after).toBeGreaterThanOrEqual(res.before + 500);
            expect(res.lives).toBe(3);
        });

        test('squashing several monsters at once escalates the points', async ({ page }) => {
            const res = await page.evaluate(() => {
                const pick = (n) => {
                    resetLevel();
                    spawnTimer = Infinity;
                    const ing = ingredients.find(
                        (i) => i.floor + 1 < FLOOR_Y.length &&
                            !ingredients.some((o) => o !== i && o.col === i.col && o.floor === i.floor + 1)
                    );
                    for (let k = 0; k < n; k++) {
                        const m = spawnMonster();
                        m.floor = ing.floor;
                        m.y = FLOOR_Y[ing.floor];
                        m.x = ing.x + 20 + k * 20;
                    }
                    const before = score;
                    dropIngredient(ing);
                    for (let i = 0; i < 600; i++) step(1 / 60);
                    return score - before;
                };
                const one = pick(1);
                const two = pick(2);
                return { one, two };
            });
            expect(res.two).toBeGreaterThan(res.one * 2);
        });
    });

    // -----------------------------------------------------------------------
    // Pepper
    // -----------------------------------------------------------------------
    test.describe('pepper', () => {
        test.beforeEach(async ({ page }) => {
            await page.evaluate(() => { startGame(); spawnTimer = Infinity; });
        });

        test('Space throws pepper and spends a shake', async ({ page }) => {
            await page.keyboard.press('Space');
            const res = await page.evaluate(() => ({ pepper, clouds: peppers.length }));
            expect(res.pepper).toBe(4);
            expect(res.clouds).toBe(1);
            await expect(page.locator('#pepper')).toHaveText('4');
        });

        test('pepper cannot be thrown when the shaker is empty', async ({ page }) => {
            const res = await page.evaluate(() => {
                pepper = 0;
                firePepper();
                return { pepper, clouds: peppers.length };
            });
            expect(res.pepper).toBe(0);
            expect(res.clouds).toBe(0);
        });

        test('the cloud appears ahead of the chef', async ({ page }) => {
            const res = await page.evaluate(() => {
                chef.dir = 1;
                firePepper();
                return { cloud: peppers[0].x, chef: chef.x };
            });
            expect(res.cloud).toBeGreaterThan(res.chef);
        });

        test('pepper freezes a monster in the cloud', async ({ page }) => {
            const stun = await page.evaluate(() => {
                chef.dir = 1;
                const m = spawnMonster();
                m.floor = chef.floor;
                m.y = chef.y;
                m.x = chef.x + 28;
                firePepper();
                step(1 / 60);
                return m.stun;
            });
            expect(stun).toBeGreaterThan(0);
        });

        test('pepper does not reach a monster on another floor', async ({ page }) => {
            const stun = await page.evaluate(() => {
                chef.dir = 1;
                const m = spawnMonster();
                m.floor = chef.floor - 1;
                m.y = FLOOR_Y[m.floor];
                m.x = chef.x + 28;
                firePepper();
                step(1 / 60);
                return m.stun;
            });
            expect(stun).toBe(0);
        });

        test('the cloud fades away', async ({ page }) => {
            await page.evaluate(() => firePepper());
            await advance(page, 2);
            expect(await page.evaluate(() => peppers.length)).toBe(0);
        });

        test('the freeze wears off', async ({ page }) => {
            const moved = await page.evaluate(() => {
                const m = spawnMonster();
                m.floor = chef.floor;
                m.y = FLOOR_Y[m.floor];
                m.x = 40;
                chef.x = 600;
                m.stun = 0.2;
                for (let i = 0; i < 180; i++) step(1 / 60);
                return { stun: m.stun, x: m.x };
            });
            expect(moved.stun).toBe(0);
            expect(moved.x).toBeGreaterThan(40);
        });
    });

    // -----------------------------------------------------------------------
    // Level flow and game over
    // -----------------------------------------------------------------------
    test.describe('level flow', () => {
        test.beforeEach(async ({ page }) => {
            await page.evaluate(() => {
                startGame();
                spawnTimer = Infinity;
                // Drop the whole board onto the plates through the real mechanics:
                // park every piece on the bottom floor, then walk them all off it.
                window.clearBoard = () => {
                    ingredients.forEach((ing) => {
                        ing.floor = FLOOR_Y.length - 1;
                        ing.stack = 0;
                        ing.y = FLOOR_Y[ing.floor] - ING_H;
                    });
                    ingredients.forEach((ing) => dropIngredient(ing));
                    for (let i = 0; i < 60; i++) step(1 / 60);
                };
            });
        });

        test('plating every ingredient clears the level', async ({ page }) => {
            const res = await page.evaluate(() => {
                const before = score;
                clearBoard();
                return { state, plated: ingredients.filter((i) => i.onPlate).length, before, after: score };
            });
            expect(res.plated).toBe(16);
            expect(res.state).toBe('levelclear');
            expect(res.after).toBeGreaterThan(res.before);
        });

        test('the next level resets the board and speeds up the monsters', async ({ page }) => {
            const res = await page.evaluate(() => {
                const speed0 = monsterSpeed();
                clearBoard();
                for (let i = 0; i < 240; i++) step(1 / 60);
                return {
                    level,
                    state,
                    plated: ingredients.filter((i) => i.onPlate).length,
                    speed0,
                    speed1: monsterSpeed(),
                };
            });
            expect(res.level).toBe(2);
            expect(res.state).toBe('running');
            expect(res.plated).toBe(0);
            expect(res.speed1).toBeGreaterThan(res.speed0);
        });

        test('clearing a level refills the pepper', async ({ page }) => {
            const p = await page.evaluate(() => {
                pepper = 1;
                clearBoard();
                for (let i = 0; i < 240; i++) step(1 / 60);
                return pepper;
            });
            expect(p).toBe(5);
        });

        test('losing the last life ends the game', async ({ page }) => {
            await page.evaluate(() => {
                lives = 1;
                const m = spawnMonster();
                m.floor = chef.floor;
                m.y = chef.y;
                m.x = chef.x;
                step(1 / 60);
            });
            expect(await page.evaluate(() => state)).toBe('over');
            await expect(page.locator('#overlay')).toHaveClass(/visible/);
            await expect(page.locator('#overlay-title')).toContainText(/over/i);
        });

        test('the best score is stored on game over', async ({ page }) => {
            const stored = await page.evaluate(() => {
                score = 4200;
                lives = 1;
                const m = spawnMonster();
                m.floor = chef.floor;
                m.y = chef.y;
                m.x = chef.x;
                step(1 / 60);
                return window.localStorage.getItem('burgertime-best');
            });
            expect(Number(stored)).toBe(4200);
            await expect(page.locator('#best')).toHaveText('4200');
        });

        test('a lower score does not overwrite the best', async ({ page }) => {
            const stored = await page.evaluate(() => {
                window.localStorage.setItem('burgertime-best', '9000');
                best = 9000;
                score = 100;
                lives = 1;
                const m = spawnMonster();
                m.floor = chef.floor;
                m.y = chef.y;
                m.x = chef.x;
                step(1 / 60);
                return window.localStorage.getItem('burgertime-best');
            });
            expect(Number(stored)).toBe(9000);
        });

        test('a new run after game over starts clean', async ({ page }) => {
            const res = await page.evaluate(() => {
                score = 800;
                lives = 1;
                const m = spawnMonster();
                m.floor = chef.floor;
                m.y = chef.y;
                m.x = chef.x;
                step(1 / 60);
                startGame();
                return { state, score, lives, level, plated: ingredients.filter((i) => i.onPlate).length };
            });
            expect(res).toEqual({ state: 'running', score: 0, lives: 3, level: 1, plated: 0 });
        });

        test('losing a life resets ingredient progress but keeps plated pieces', async ({ page }) => {
            const res = await page.evaluate(() => {
                const ing = ingredients[0];
                ing.stepped = [true, true, true, false];
                const plated = ingredients[4];
                plated.floor = FLOOR_Y.length - 1;
                plated.y = FLOOR_Y[plated.floor] - ING_H;
                dropIngredient(plated);
                for (let i = 0; i < 600; i++) step(1 / 60);
                const m = spawnMonster();
                m.floor = chef.floor;
                m.y = chef.y;
                m.x = chef.x;
                step(1 / 60);
                return { stepped: ingredients[0].stepped.some(Boolean), stillPlated: plated.onPlate };
            });
            expect(res.stepped).toBe(false);
            expect(res.stillPlated).toBe(true);
        });
    });

    // -----------------------------------------------------------------------
    // Pause
    // -----------------------------------------------------------------------
    test.describe('pause', () => {
        test('P pauses and resumes', async ({ page }) => {
            await page.evaluate(() => startGame());
            await page.keyboard.press('KeyP');
            expect(await page.evaluate(() => state)).toBe('paused');
            await page.keyboard.press('KeyP');
            expect(await page.evaluate(() => state)).toBe('running');
        });

        test('nothing moves while paused', async ({ page }) => {
            await page.evaluate(() => startGame());
            await page.keyboard.press('KeyP');
            const before = await page.evaluate(() => chef.x);
            await page.keyboard.down('ArrowRight');
            await advance(page, 1);
            expect(await page.evaluate(() => chef.x)).toBe(before);
        });

        test('pause does nothing before the game starts', async ({ page }) => {
            await page.keyboard.press('KeyP');
            expect(await page.evaluate(() => state)).toBe('idle');
        });
    });

    // -----------------------------------------------------------------------
    // Playability: the level can actually be finished by walking
    // -----------------------------------------------------------------------
    test.describe('playthrough', () => {
        test('walking a piece across every floor plates it', async ({ page }) => {
            const res = await page.evaluate(() => {
                startGame();
                spawnTimer = Infinity;
                const ing = ingredients[0];
                let trips = 0;
                while (!ing.onPlate && trips++ < 20) {
                    // Stand at the left edge of the piece and hold right, exactly
                    // as a player would, until the whole piece is trodden.
                    chef.riding = null;
                    chef.floor = ing.floor;
                    chef.y = FLOOR_Y[ing.floor];
                    chef.x = ing.x - 2;
                    input.right = true;
                    for (let i = 0; i < 300 && !ing.falling; i++) step(1 / 60);
                    input.right = false;
                    for (let i = 0; i < 300 && ing.falling; i++) step(1 / 60);
                }
                return { onPlate: ing.onPlate, trips, y: ing.y };
            });
            expect(res.onPlate).toBe(true);
            expect(res.trips).toBeLessThanOrEqual(20);
        });

        test('walking every piece down clears the level', async ({ page }) => {
            const res = await page.evaluate(() => {
                startGame();
                spawnTimer = Infinity;
                const walk = (ing) => {
                    let trips = 0;
                    while (!ing.onPlate && trips++ < 20) {
                        chef.riding = null;
                        chef.floor = ing.floor;
                        chef.y = FLOOR_Y[ing.floor];
                        chef.x = ing.x - 2;
                        input.right = true;
                        for (let i = 0; i < 300 && !ing.falling; i++) step(1 / 60);
                        input.right = false;
                        for (let i = 0; i < 300 && ing.falling; i++) step(1 / 60);
                    }
                };
                // A player works a stack bottom-up so the burger lands in order.
                for (let col = 0; col < 4; col++) {
                    const stack = ingredients
                        .filter((i) => i.col === col)
                        .sort((a, b) => b.floor - a.floor);
                    stack.forEach(walk);
                }
                return {
                    plated: ingredients.filter((i) => i.onPlate).length,
                    state,
                    score,
                    order: [0, 1, 2, 3].map((col) =>
                        ingredients
                            .filter((i) => i.col === col)
                            .sort((a, b) => b.y - a.y)
                            .map((i) => i.type)
                            .join('>')
                    ),
                };
            });
            expect(res.plated).toBe(16);
            expect(res.state).toBe('levelclear');
            expect(res.score).toBeGreaterThan(0);
            // Bottom-up walking assembles a burger the right way up.
            expect(res.order).toEqual(Array(4).fill('bottomBun>patty>lettuce>topBun'));
        });
    });

    // -----------------------------------------------------------------------
    // Rendering
    // -----------------------------------------------------------------------
    test.describe('rendering', () => {
        test('the canvas paints something', async ({ page }) => {
            await page.evaluate(() => { startGame(); draw(); });
            const blank = await page.evaluate(() => {
                const data = ctx.getImageData(0, 0, CANVAS_W, CANVAS_H).data;
                const first = [data[0], data[1], data[2]];
                for (let i = 4; i < data.length; i += 4) {
                    if (data[i] !== first[0] || data[i + 1] !== first[1] || data[i + 2] !== first[2]) return false;
                }
                return true;
            });
            expect(blank).toBe(false);
        });

        test('no console errors during a run', async ({ page }) => {
            const errors = [];
            page.on('pageerror', (e) => errors.push(e.message));
            await page.goto(GAME_URL);
            await page.evaluate(() => startGame());
            await advance(page, 20);
            expect(errors).toEqual([]);
        });
    });
});
