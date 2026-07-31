const { test, expect } = require('@playwright/test');
const path = require('path');
const { pathToFileURL } = require('url');

const GAME_URL = pathToFileURL(path.resolve(__dirname, '../index.html')).href;

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

        test('HUD starts at zero score, 3 lives, 5 peppers, level 1', async ({ page }) => {
            await expect(page.locator('#score')).toHaveText('0');
            await expect(page.locator('#lives')).toHaveText('3');
            await expect(page.locator('#pepper')).toHaveText('5');
            await expect(page.locator('#level')).toHaveText('1');
            await expect(page.locator('#best')).toHaveText('0');
        });

        test('canvas is 600x520', async ({ page }) => {
            const canvas = page.locator('#canvas');
            await expect(canvas).toHaveAttribute('width', '600');
            await expect(canvas).toHaveAttribute('height', '520');
        });

        test('state is idle before starting', async ({ page }) => {
            expect(await page.evaluate(() => state)).toBe('idle');
        });

        test('no enemies before starting', async ({ page }) => {
            expect(await page.evaluate(() => enemies.length)).toBe(0);
        });

        test('best score loads from localStorage', async ({ page }) => {
            await page.evaluate(() => window.localStorage.setItem('burgertime-best', '4200'));
            await page.reload();
            await expect(page.locator('#best')).toHaveText('4200');
        });
    });

    // -----------------------------------------------------------------------
    // Level geometry
    // -----------------------------------------------------------------------
    test.describe('level layout', () => {
        test('there are six floors, all inside the canvas', async ({ page }) => {
            const floors = await page.evaluate(() => FLOOR_Y);
            expect(floors).toHaveLength(6);
            for (const y of floors) {
                expect(y).toBeGreaterThan(0);
                expect(y).toBeLessThan(520);
            }
            expect([...floors].sort((a, b) => a - b)).toEqual(floors);
        });

        test('the plate level is the bottom floor', async ({ page }) => {
            const { plate, floors } = await page.evaluate(() => ({
                plate: PLATE_LEVEL,
                floors: FLOOR_Y.length,
            }));
            expect(plate).toBe(floors - 1);
        });

        test('every ladder sits inside the play field and spans real floors', async ({ page }) => {
            const ladders = await page.evaluate(() => LADDERS.map((l) => ({ ...l })));
            expect(ladders.length).toBeGreaterThanOrEqual(4);
            for (const l of ladders) {
                expect(l.x).toBeGreaterThan(0);
                expect(l.x).toBeLessThan(600);
                expect(l.bottom).toBeGreaterThan(l.top);
                expect(l.top).toBeGreaterThanOrEqual(0);
                expect(l.bottom).toBeLessThanOrEqual(5);
            }
        });

        test('every floor is reachable by at least one ladder', async ({ page }) => {
            const covered = await page.evaluate(() =>
                FLOOR_Y.map((_, i) => LADDERS.some((l) => l.top <= i && l.bottom >= i))
            );
            expect(covered.every(Boolean)).toBe(true);
        });

        test('there are three burgers of four ingredients each', async ({ page }) => {
            const info = await page.evaluate(() => {
                startGame();
                return {
                    burgers: BURGER_X.length,
                    total: ingredients.length,
                    perBurger: BURGER_X.map(
                        (_, b) => ingredients.filter((i) => i.burger === b).length
                    ),
                };
            });
            expect(info.burgers).toBe(3);
            expect(info.total).toBe(12);
            expect(info.perBurger).toEqual([4, 4, 4]);
        });

        test('each ingredient has four un-stepped segments', async ({ page }) => {
            const ok = await page.evaluate(() => {
                startGame();
                return ingredients.every(
                    (i) => i.segments.length === 4 && i.segments.every((s) => !s.stepped)
                );
            });
            expect(ok).toBe(true);
        });

        test('each burger stacks its four ingredients on floors 0-3', async ({ page }) => {
            const levels = await page.evaluate(() => {
                startGame();
                return BURGER_X.map((_, b) =>
                    ingredients
                        .filter((i) => i.burger === b)
                        .map((i) => i.level)
                        .sort((a, b2) => a - b2)
                );
            });
            expect(levels).toEqual([
                [0, 1, 2, 3],
                [0, 1, 2, 3],
                [0, 1, 2, 3],
            ]);
        });

        test('all plates start empty', async ({ page }) => {
            const plates = await page.evaluate(() => {
                startGame();
                return [...plates];
            });
            expect(plates).toEqual([0, 0, 0]);
        });

        test('floorIndexAt maps floor Y values to their index', async ({ page }) => {
            const found = await page.evaluate(() => FLOOR_Y.map((y) => floorIndexAt(y)));
            expect(found).toEqual([0, 1, 2, 3, 4, 5]);
        });

        test('floorIndexAt returns -1 between floors', async ({ page }) => {
            const idx = await page.evaluate(() => floorIndexAt((FLOOR_Y[0] + FLOOR_Y[1]) / 2));
            expect(idx).toBe(-1);
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

        test('starting resets score, lives, pepper and level', async ({ page }) => {
            const s = await page.evaluate(() => {
                score = 999;
                lives = 1;
                pepper = 0;
                levelNumber = 7;
                startGame();
                return { score, lives, pepper, levelNumber };
            });
            expect(s).toEqual({ score: 0, lives: 3, pepper: 5, levelNumber: 1 });
        });

        test('the chef starts standing on a floor', async ({ page }) => {
            const idx = await page.evaluate(() => {
                startGame();
                return floorIndexAt(chef.y);
            });
            expect(idx).toBeGreaterThanOrEqual(0);
        });

        test('three enemies are on the board at level 1', async ({ page }) => {
            const n = await page.evaluate(() => {
                startGame();
                return enemies.length;
            });
            expect(n).toBe(3);
        });

        test('enemies all stand on floors and inside the field', async ({ page }) => {
            const ok = await page.evaluate(() => {
                startGame();
                return enemies.every(
                    (e) => floorIndexAt(e.y) >= 0 && e.x > 0 && e.x < CANVAS_W
                );
            });
            expect(ok).toBe(true);
        });
    });

    // -----------------------------------------------------------------------
    // Chef movement
    // -----------------------------------------------------------------------
    test.describe('chef movement', () => {
        test('walking right increases x', async ({ page }) => {
            const moved = await page.evaluate(() => {
                startGame();
                enemies.length = 0;
                const x0 = chef.x;
                setChefDir(1, 0);
                for (let i = 0; i < 30; i++) step(1 / 60);
                return chef.x - x0;
            });
            expect(moved).toBeGreaterThan(10);
        });

        test('walking left decreases x', async ({ page }) => {
            const moved = await page.evaluate(() => {
                startGame();
                enemies.length = 0;
                const x0 = chef.x;
                setChefDir(-1, 0);
                for (let i = 0; i < 30; i++) step(1 / 60);
                return chef.x - x0;
            });
            expect(moved).toBeLessThan(-10);
        });

        test('the chef cannot walk off the right edge', async ({ page }) => {
            const x = await page.evaluate(() => {
                startGame();
                enemies.length = 0;
                setChefDir(1, 0);
                for (let i = 0; i < 900; i++) step(1 / 60);
                return chef.x;
            });
            expect(x).toBeLessThanOrEqual(600);
            expect(x).toBeGreaterThan(500);
        });

        test('the chef cannot walk off the left edge', async ({ page }) => {
            const x = await page.evaluate(() => {
                startGame();
                enemies.length = 0;
                setChefDir(-1, 0);
                for (let i = 0; i < 900; i++) step(1 / 60);
                return chef.x;
            });
            expect(x).toBeGreaterThanOrEqual(0);
            expect(x).toBeLessThan(100);
        });

        test('the chef cannot climb where there is no ladder', async ({ page }) => {
            const dy = await page.evaluate(() => {
                startGame();
                enemies.length = 0;
                // Park the chef midway between two ladders.
                chef.x = (LADDERS[0].x + LADDERS[1].x) / 2;
                chef.y = FLOOR_Y[3];
                const y0 = chef.y;
                setChefDir(0, -1);
                for (let i = 0; i < 60; i++) step(1 / 60);
                return chef.y - y0;
            });
            expect(dy).toBe(0);
        });

        test('the chef climbs up a ladder and snaps to its column', async ({ page }) => {
            const res = await page.evaluate(() => {
                startGame();
                enemies.length = 0;
                const ladder = LADDERS.find((l) => l.top === 0 && l.bottom === 5);
                chef.x = ladder.x + 6;
                chef.y = FLOOR_Y[3];
                setChefDir(0, -1);
                for (let i = 0; i < 30; i++) step(1 / 60);
                return { x: chef.x, ladderX: ladder.x, y: chef.y, from: FLOOR_Y[3] };
            });
            expect(res.x).toBeCloseTo(res.ladderX, 5);
            expect(res.y).toBeLessThan(res.from);
        });

        test('climbing stops at the top floor', async ({ page }) => {
            const res = await page.evaluate(() => {
                startGame();
                enemies.length = 0;
                const ladder = LADDERS.find((l) => l.top === 0 && l.bottom === 5);
                chef.x = ladder.x;
                chef.y = FLOOR_Y[5];
                setChefDir(0, -1);
                for (let i = 0; i < 900; i++) step(1 / 60);
                return { y: chef.y, top: FLOOR_Y[0] };
            });
            expect(res.y).toBeCloseTo(res.top, 5);
        });

        test('climbing down stops at the bottom floor', async ({ page }) => {
            const res = await page.evaluate(() => {
                startGame();
                enemies.length = 0;
                const ladder = LADDERS.find((l) => l.top === 0 && l.bottom === 5);
                chef.x = ladder.x;
                chef.y = FLOOR_Y[0];
                setChefDir(0, 1);
                for (let i = 0; i < 900; i++) step(1 / 60);
                return { y: chef.y, bottom: FLOOR_Y[5] };
            });
            expect(res.y).toBeCloseTo(res.bottom, 5);
        });

        test('a short ladder cannot be climbed above its top floor', async ({ page }) => {
            const res = await page.evaluate(() => {
                startGame();
                enemies.length = 0;
                const ladder = LADDERS.find((l) => l.top > 0);
                if (!ladder) return null;
                chef.x = ladder.x;
                chef.y = FLOOR_Y[ladder.bottom];
                setChefDir(0, -1);
                for (let i = 0; i < 900; i++) step(1 / 60);
                return { y: chef.y, top: FLOOR_Y[ladder.top] };
            });
            expect(res).not.toBeNull();
            expect(res.y).toBeCloseTo(res.top, 5);
        });

        test('the chef cannot walk sideways while on a ladder', async ({ page }) => {
            const dx = await page.evaluate(() => {
                startGame();
                enemies.length = 0;
                const ladder = LADDERS.find((l) => l.top === 0 && l.bottom === 5);
                chef.x = ladder.x;
                chef.y = (FLOOR_Y[2] + FLOOR_Y[3]) / 2; // mid-ladder
                const x0 = chef.x;
                setChefDir(1, 0);
                for (let i = 0; i < 60; i++) step(1 / 60);
                return chef.x - x0;
            });
            expect(dx).toBe(0);
        });

        test('facing follows horizontal input', async ({ page }) => {
            const facings = await page.evaluate(() => {
                startGame();
                enemies.length = 0;
                setChefDir(1, 0);
                step(1 / 60);
                const right = chef.facing;
                setChefDir(-1, 0);
                step(1 / 60);
                return [right, chef.facing];
            });
            expect(facings).toEqual([1, -1]);
        });

        test('arrow keys drive the chef', async ({ page }) => {
            await page.keyboard.press('Space');
            await page.evaluate(() => { enemies.length = 0; });
            const before = await page.evaluate(() => chef.x);
            await page.keyboard.down('ArrowRight');
            await page.evaluate(() => { for (let i = 0; i < 30; i++) step(1 / 60); });
            await page.keyboard.up('ArrowRight');
            const after = await page.evaluate(() => chef.x);
            expect(after).toBeGreaterThan(before);
        });
    });

    // -----------------------------------------------------------------------
    // Stepping on ingredients
    // -----------------------------------------------------------------------
    test.describe('ingredients', () => {
        test('walking over a segment marks it stepped', async ({ page }) => {
            const res = await page.evaluate(() => {
                startGame();
                enemies.length = 0;
                const ing = ingredients.find((i) => i.burger === 0 && i.level === 0);
                chef.y = FLOOR_Y[ing.level];
                chef.x = ing.x + SEG_W / 2;
                step(1 / 60);
                return ing.segments.map((s) => s.stepped);
            });
            expect(res).toEqual([true, false, false, false]);
        });

        test('standing on a different floor does not step an ingredient', async ({ page }) => {
            const res = await page.evaluate(() => {
                startGame();
                enemies.length = 0;
                const ing = ingredients.find((i) => i.burger === 0 && i.level === 0);
                chef.y = FLOOR_Y[ing.level + 1];
                chef.x = ing.x + SEG_W / 2;
                step(1 / 60);
                return ing.segments.some((s) => s.stepped);
            });
            expect(res).toBe(false);
        });

        test('walking across all four segments drops the ingredient', async ({ page }) => {
            const res = await page.evaluate(() => {
                startGame();
                enemies.length = 0;
                const ing = ingredients.find((i) => i.burger === 0 && i.level === 0);
                chef.y = FLOOR_Y[ing.level];
                chef.x = ing.x - 4;
                setChefDir(1, 0);
                for (let i = 0; i < 240 && !ing.falling && ing.level === 0; i++) step(1 / 60);
                return { falling: ing.falling, level: ing.level };
            });
            expect(res.falling || res.level > 0).toBe(true);
        });

        test('dropIngredient makes it fall one floor and resets its segments', async ({ page }) => {
            const res = await page.evaluate(() => {
                startGame();
                chef.x = 595;
                chef.y = FLOOR_Y[4];
                enemies.length = 0;
                const ing = ingredients.find((i) => i.burger === 2 && i.level === 0);
                dropIngredient(ing);
                const wasFalling = ing.falling;
                for (let i = 0; i < 300; i++) step(1 / 60);
                return {
                    wasFalling,
                    level: ing.level,
                    falling: ing.falling,
                    stepped: ing.segments.filter((s) => s.stepped).length,
                    y: ing.y,
                    restY: FLOOR_Y[1] - ING_H,
                };
            });
            expect(res.wasFalling).toBe(true);
            expect(res.level).toBe(1);
            expect(res.falling).toBe(false);
            expect(res.stepped).toBe(0);
            expect(res.y).toBeCloseTo(res.restY, 3);
        });

        test('a dropped ingredient scores points', async ({ page }) => {
            const res = await page.evaluate(() => {
                startGame();
                chef.x = 595;
                chef.y = FLOOR_Y[4];
                enemies.length = 0;
                const ing = ingredients.find((i) => i.burger === 2 && i.level === 3);
                dropIngredient(ing);
                for (let i = 0; i < 300; i++) step(1 / 60);
                return score;
            });
            expect(res).toBe(50);
        });

        test('an ingredient landing on an occupied floor knocks that one down', async ({ page }) => {
            const res = await page.evaluate(() => {
                startGame();
                chef.x = 595;
                chef.y = FLOOR_Y[4];
                enemies.length = 0;
                const top = ingredients.find((i) => i.burger === 1 && i.level === 0);
                dropIngredient(top);
                for (let i = 0; i < 600; i++) step(1 / 60);
                return ingredients
                    .filter((i) => i.burger === 1)
                    .map((i) => i.level)
                    .sort((a, b) => a - b);
            });
            expect(res).toEqual([1, 2, 3, 4]);
        });

        test('an ingredient reaching the plate is plated and counted', async ({ page }) => {
            const res = await page.evaluate(() => {
                startGame();
                chef.x = 595;
                chef.y = FLOOR_Y[4];
                enemies.length = 0;
                const low = ingredients.find((i) => i.burger === 0 && i.level === 3);
                low.level = PLATE_LEVEL - 1;
                low.y = FLOOR_Y[low.level] - ING_H;
                dropIngredient(low);
                for (let i = 0; i < 300; i++) step(1 / 60);
                return { plated: low.plated, plate: plates[0] };
            });
            expect(res.plated).toBe(true);
            expect(res.plate).toBe(1);
        });

        test('plated ingredients stack above the plate', async ({ page }) => {
            const res = await page.evaluate(() => {
                startGame();
                chef.x = 595;
                chef.y = FLOOR_Y[4];
                enemies.length = 0;
                const burger = ingredients.filter((i) => i.burger === 0);
                for (const ing of burger) {
                    ing.level = PLATE_LEVEL - 1;
                    ing.y = FLOOR_Y[ing.level] - ING_H;
                    dropIngredient(ing);
                    for (let i = 0; i < 120; i++) step(1 / 60);
                }
                const ys = burger.map((i) => i.y).sort((a, b) => a - b);
                return { plate: plates[0], ys, unique: new Set(ys).size };
            });
            expect(res.plate).toBe(4);
            expect(res.unique).toBe(4);
        });
    });

    // -----------------------------------------------------------------------
    // Pepper
    // -----------------------------------------------------------------------
    test.describe('pepper', () => {
        test('spraying uses one pepper', async ({ page }) => {
            const res = await page.evaluate(() => {
                startGame();
                enemies.length = 0;
                const before = pepper;
                const sprayed = sprayPepper();
                return { before, after: pepper, sprayed, clouds: sprays.length };
            });
            expect(res.before).toBe(5);
            expect(res.after).toBe(4);
            expect(res.sprayed).toBe(true);
            expect(res.clouds).toBe(1);
        });

        test('spraying with no pepper left does nothing', async ({ page }) => {
            const res = await page.evaluate(() => {
                startGame();
                enemies.length = 0;
                pepper = 0;
                const sprayed = sprayPepper();
                return { sprayed, clouds: sprays.length, pepper };
            });
            expect(res.sprayed).toBe(false);
            expect(res.clouds).toBe(0);
            expect(res.pepper).toBe(0);
        });

        test('pepper stuns an enemy in front of the chef', async ({ page }) => {
            const stun = await page.evaluate(() => {
                startGame();
                enemies.length = 0;
                chef.x = 300;
                chef.y = FLOOR_Y[4];
                chef.facing = 1;
                const e = spawnEnemy('hotdog', chef.x + 26, chef.y);
                sprayPepper();
                step(1 / 60);
                return e.stun;
            });
            expect(stun).toBeGreaterThan(0);
        });

        test('a stunned enemy does not move', async ({ page }) => {
            const moved = await page.evaluate(() => {
                startGame();
                enemies.length = 0;
                chef.x = 100;
                chef.y = FLOOR_Y[4];
                const e = spawnEnemy('hotdog', 400, FLOOR_Y[4]);
                e.stun = 3;
                const x0 = e.x;
                for (let i = 0; i < 60; i++) step(1 / 60);
                return Math.abs(e.x - x0);
            });
            expect(moved).toBe(0);
        });

        test('a stun wears off', async ({ page }) => {
            const stun = await page.evaluate(() => {
                startGame();
                enemies.length = 0;
                chef.x = 100;
                chef.y = FLOOR_Y[4];
                const e = spawnEnemy('hotdog', 400, FLOOR_Y[4]);
                e.stun = 0.2;
                for (let i = 0; i < 60; i++) step(1 / 60);
                return e.stun;
            });
            expect(stun).toBe(0);
        });

        test('the spray cloud expires', async ({ page }) => {
            const clouds = await page.evaluate(() => {
                startGame();
                enemies.length = 0;
                sprayPepper();
                for (let i = 0; i < 120; i++) step(1 / 60);
                return sprays.length;
            });
            expect(clouds).toBe(0);
        });

        test('the HUD shows the remaining pepper', async ({ page }) => {
            await page.evaluate(() => {
                startGame();
                enemies.length = 0;
                sprayPepper();
            });
            await expect(page.locator('#pepper')).toHaveText('4');
        });
    });

    // -----------------------------------------------------------------------
    // Enemies
    // -----------------------------------------------------------------------
    test.describe('enemies', () => {
        test('an enemy walks toward the chef along a floor', async ({ page }) => {
            const res = await page.evaluate(() => {
                startGame();
                enemies.length = 0;
                chef.x = 100;
                chef.y = FLOOR_Y[4];
                const e = spawnEnemy('hotdog', 500, FLOOR_Y[4]);
                const d0 = Math.abs(e.x - chef.x);
                for (let i = 0; i < 60; i++) step(1 / 60);
                return { d0, d1: Math.abs(e.x - chef.x) };
            });
            expect(res.d1).toBeLessThan(res.d0);
        });

        test('an enemy climbs toward a chef on another floor', async ({ page }) => {
            const res = await page.evaluate(() => {
                startGame();
                enemies.length = 0;
                const ladder = LADDERS.find((l) => l.top === 0 && l.bottom === 5);
                chef.x = ladder.x;
                chef.y = FLOOR_Y[0];
                const e = spawnEnemy('pickle', ladder.x, FLOOR_Y[5]);
                const y0 = e.y;
                for (let i = 0; i < 180; i++) step(1 / 60);
                return { y0, y1: e.y };
            });
            expect(res.y1).toBeLessThan(res.y0);
        });

        test('touching an enemy costs a life and resets positions', async ({ page }) => {
            const res = await page.evaluate(() => {
                startGame();
                enemies.length = 0;
                chef.x = 300;
                chef.y = FLOOR_Y[4];
                spawnEnemy('hotdog', 302, FLOOR_Y[4]);
                step(1 / 60);
                return { lives, chefX: chef.x, state };
            });
            expect(res.lives).toBe(2);
            expect(res.state).toBe('running');
        });

        test('losing the last life ends the game', async ({ page }) => {
            const res = await page.evaluate(() => {
                startGame();
                lives = 1;
                enemies.length = 0;
                chef.x = 300;
                chef.y = FLOOR_Y[4];
                spawnEnemy('hotdog', 302, FLOOR_Y[4]);
                step(1 / 60);
                return { lives, state };
            });
            expect(res.lives).toBe(0);
            expect(res.state).toBe('over');
            await expect(page.locator('#overlay')).toHaveClass(/visible/);
            await expect(page.locator('#overlay-title')).toContainText(/over/i);
        });

        test('a falling ingredient squashes an enemy', async ({ page }) => {
            const res = await page.evaluate(() => {
                startGame();
                chef.x = 595;
                chef.y = FLOOR_Y[4];
                enemies.length = 0;
                const ing = ingredients.find((i) => i.burger === 1 && i.level === 3);
                const e = spawnEnemy('egg', ing.x + 2 * SEG_W, FLOOR_Y[4]);
                dropIngredient(ing);
                for (let i = 0; i < 300; i++) step(1 / 60);
                return { alive: e.alive, present: enemies.includes(e), score };
            });
            expect(res.alive).toBe(false);
            expect(res.score).toBeGreaterThanOrEqual(500);
        });

        test('squashed enemies come back', async ({ page }) => {
            const res = await page.evaluate(() => {
                startGame();
                chef.x = 595;
                chef.y = FLOOR_Y[4];
                enemies.length = 0;
                const ing = ingredients.find((i) => i.burger === 1 && i.level === 3);
                spawnEnemy('egg', ing.x + 2 * SEG_W, FLOOR_Y[4]);
                dropIngredient(ing);
                for (let i = 0; i < 60 * 12; i++) step(1 / 60);
                return enemies.filter((e) => e.alive).length;
            });
            expect(res).toBeGreaterThanOrEqual(1);
        });

        test('enemies do not leave the play field', async ({ page }) => {
            const ok = await page.evaluate(() => {
                startGame();
                for (let i = 0; i < 60 * 10; i++) step(1 / 60);
                return enemies.every((e) => e.x >= 0 && e.x <= CANVAS_W && e.y >= 0 && e.y <= CANVAS_H);
            });
            expect(ok).toBe(true);
        });
    });

    // -----------------------------------------------------------------------
    // Winning a level
    // -----------------------------------------------------------------------
    test.describe('level completion', () => {
        // Shortcut a whole level: move every ingredient to the floor above the
        // plate and drop it, letting the simulation resolve each landing.
        const PLATE_ALL = `
            startGame();
            chef.x = 595;
            chef.y = FLOOR_Y[4];
            enemies.length = 0;
            for (const ing of [...ingredients]) {
                ing.level = PLATE_LEVEL - 1;
                ing.y = FLOOR_Y[ing.level] - ING_H;
                dropIngredient(ing);
                for (let i = 0; i < 120; i++) step(1 / 60);
            }
        `;

        test('plating every ingredient advances the level', async ({ page }) => {
            const res = await page.evaluate(
                `(() => { ${PLATE_ALL} return { levelNumber, state }; })()`
            );
            expect(res.levelNumber).toBe(2);
            expect(res.state).toBe('running');
        });

        test('completing a level awards a bonus', async ({ page }) => {
            const res = await page.evaluate(`(() => { ${PLATE_ALL} return score; })()`);
            // 12 drops at 50 each plus the level bonus.
            expect(res).toBeGreaterThanOrEqual(600 + 1000);
        });

        test('a new level rebuilds the burgers', async ({ page }) => {
            const res = await page.evaluate(`(() => { ${PLATE_ALL} return {
                count: ingredients.length,
                plated: ingredients.filter((i) => i.plated).length,
                plates: [...plates],
                enemies: enemies.length,
            }; })()`);
            expect(res.count).toBe(12);
            expect(res.plated).toBe(0);
            expect(res.plates).toEqual([0, 0, 0]);
            expect(res.enemies).toBe(4);
        });
    });

    // -----------------------------------------------------------------------
    // Pause & HUD
    // -----------------------------------------------------------------------
    test.describe('pause and HUD', () => {
        test('P pauses and resumes', async ({ page }) => {
            await page.keyboard.press('Space');
            await page.keyboard.press('p');
            expect(await page.evaluate(() => state)).toBe('paused');
            await page.keyboard.press('p');
            expect(await page.evaluate(() => state)).toBe('running');
        });

        test('the world is frozen while paused', async ({ page }) => {
            const moved = await page.evaluate(() => {
                startGame();
                togglePause();
                const x0 = chef.x;
                setChefDir(1, 0);
                for (let i = 0; i < 60; i++) step(1 / 60);
                return chef.x - x0;
            });
            expect(moved).toBe(0);
        });

        test('the HUD tracks score and lives', async ({ page }) => {
            await page.evaluate(() => {
                startGame();
                chef.x = 595;
                chef.y = FLOOR_Y[4];
                enemies.length = 0;
                const ing = ingredients.find((i) => i.burger === 2 && i.level === 3);
                dropIngredient(ing);
                for (let i = 0; i < 300; i++) step(1 / 60);
            });
            await expect(page.locator('#score')).toHaveText('50');
            await expect(page.locator('#lives')).toHaveText('3');
        });

        test('the best score is saved on game over', async ({ page }) => {
            await page.evaluate(() => {
                startGame();
                enemies.length = 0;
                score = 3210;
                lives = 1;
                chef.x = 300;
                chef.y = FLOOR_Y[4];
                spawnEnemy('hotdog', 302, FLOOR_Y[4]);
                step(1 / 60);
            });
            await expect(page.locator('#best')).toHaveText('3210');
            const stored = await page.evaluate(() =>
                window.localStorage.getItem('burgertime-best')
            );
            expect(stored).toBe('3210');
        });

        test('the overlay reports the final score', async ({ page }) => {
            await page.evaluate(() => {
                startGame();
                enemies.length = 0;
                score = 777;
                lives = 1;
                chef.x = 300;
                chef.y = FLOOR_Y[4];
                spawnEnemy('hotdog', 302, FLOOR_Y[4]);
                step(1 / 60);
            });
            await expect(page.locator('#overlay-score')).toContainText('777');
        });

        test('restarting after game over clears the board', async ({ page }) => {
            const res = await page.evaluate(() => {
                startGame();
                enemies.length = 0;
                score = 500;
                lives = 1;
                chef.x = 300;
                chef.y = FLOOR_Y[4];
                spawnEnemy('hotdog', 302, FLOOR_Y[4]);
                step(1 / 60);
                startGame();
                return { state, score, lives, plated: ingredients.filter((i) => i.plated).length };
            });
            expect(res).toEqual({ state: 'running', score: 0, lives: 3, plated: 0 });
        });
    });

    // -----------------------------------------------------------------------
    // Rendering
    // -----------------------------------------------------------------------
    test.describe('rendering', () => {
        test('the canvas is painted', async ({ page }) => {
            await page.evaluate(() => {
                startGame();
                draw();
            });
            const painted = await page.evaluate(() => {
                const data = ctx.getImageData(0, 0, CANVAS_W, CANVAS_H).data;
                for (let i = 3; i < data.length; i += 4) if (data[i] > 0) return true;
                return false;
            });
            expect(painted).toBe(true);
        });

        test('the game loop runs without throwing', async ({ page }) => {
            const errors = [];
            page.on('pageerror', (e) => errors.push(e.message));
            await page.keyboard.press('Space');
            await page.waitForTimeout(600);
            expect(errors).toEqual([]);
        });
    });
});
