const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');

const GAME_URL = pathToFileURL(path.resolve(__dirname, '../index.html')).href;

// Advance the simulation deterministically: disable the rAF-driven stepping and
// run `frames` fixed 1/60s steps by hand.
const SIM = `
    window.__sim = (frames, dt) => {
        autoStep = false;
        for (let i = 0; i < (frames || 0); i++) step(dt || 1 / 60);
    };
`;

test.describe('BurgerTime', () => {
    test.beforeEach(async ({ page }) => {
        await page.goto(GAME_URL);
        await page.evaluate(SIM);
        // Deterministic by default: the rAF loop does not advance the sim and
        // enemies only appear when a test asks for them.
        await page.evaluate(() => { autoStep = false; spawnEnabled = false; });
    });

    // -----------------------------------------------------------------------
    // Initial / idle state
    // -----------------------------------------------------------------------
    test.describe('initial state', () => {
        test('page title is BurgerTime', async ({ page }) => {
            await expect(page).toHaveTitle('BurgerTime');
        });

        test('canvas is 600x480', async ({ page }) => {
            await expect(page.locator('#canvas')).toHaveAttribute('width', '600');
            await expect(page.locator('#canvas')).toHaveAttribute('height', '480');
        });

        test('start overlay is visible and prompts the player', async ({ page }) => {
            await expect(page.locator('#overlay')).toHaveClass(/visible/);
            await expect(page.locator('#overlay-sub')).toContainText(/space|start/i);
        });

        test('state is idle before starting', async ({ page }) => {
            expect(await page.evaluate(() => state)).toBe('idle');
        });

        test('HUD starts at score 0, level 1, 3 lives, 5 pepper', async ({ page }) => {
            await expect(page.locator('#score')).toHaveText('0');
            await expect(page.locator('#level')).toHaveText('1');
            await expect(page.locator('#lives')).toHaveText('3');
            await expect(page.locator('#pepper')).toHaveText('5');
        });

        test('best score loads from localStorage', async ({ page }) => {
            await page.evaluate(() => window.localStorage.setItem('burgertime-best', '4200'));
            await page.reload();
            await expect(page.locator('#best')).toHaveText('4200');
        });

        test('there are 4 burgers of 4 ingredients each', async ({ page }) => {
            const info = await page.evaluate(() => ({
                total: ingredients.length,
                burgers: BURGER_X.length,
                perBurger: [0, 1, 2, 3].map((b) => ingredients.filter((i) => i.burger === b).length),
            }));
            expect(info.burgers).toBe(4);
            expect(info.total).toBe(16);
            expect(info.perBurger).toEqual([4, 4, 4, 4]);
        });

        test('each burger starts stacked on the top four floors', async ({ page }) => {
            const levels = await page.evaluate(() =>
                [0, 1, 2, 3].map((b) =>
                    ingredients.filter((i) => i.burger === b).map((i) => i.level).sort()));
            expect(levels).toEqual([[0, 1, 2, 3], [0, 1, 2, 3], [0, 1, 2, 3], [0, 1, 2, 3]]);
        });

        test('every ingredient starts with all segments un-pressed', async ({ page }) => {
            const pressed = await page.evaluate(() =>
                ingredients.some((i) => i.segs.some(Boolean)));
            expect(pressed).toBe(false);
        });

        test('no enemies before starting', async ({ page }) => {
            expect(await page.evaluate(() => enemies.length)).toBe(0);
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

        test('the chef starts on the bottom floor, on a ladder column', async ({ page }) => {
            const chefPos = await page.evaluate(() => {
                startGame();
                return { x: chef.x, y: chef.y, bottom: FLOOR_Y[FLOOR_Y.length - 1], ladders: LADDER_X };
            });
            expect(chefPos.y).toBe(chefPos.bottom);
            expect(chefPos.ladders).toContain(chefPos.x);
        });

        test('starting resets score, lives and pepper', async ({ page }) => {
            const s = await page.evaluate(() => {
                score = 999; lives = 1; pepper = 0;
                startGame();
                return { score, lives, pepper, level };
            });
            expect(s).toEqual({ score: 0, lives: 3, pepper: 5, level: 1 });
        });

        test('the canvas is actually painted after starting', async ({ page }) => {
            const painted = await page.evaluate(() => {
                startGame();
                draw();
                const d = canvas.getContext('2d').getImageData(0, 0, CANVAS_W, CANVAS_H).data;
                const colours = new Set();
                for (let i = 0; i < d.length; i += 4) colours.add(`${d[i]},${d[i + 1]},${d[i + 2]}`);
                return colours.size;
            });
            expect(painted).toBeGreaterThan(3);
        });
    });

    // -----------------------------------------------------------------------
    // Chef movement over the lattice
    // -----------------------------------------------------------------------
    test.describe('movement', () => {
        test('walking right moves the chef along the floor', async ({ page }) => {
            const r = await page.evaluate(() => {
                startGame();
                const y0 = chef.y, x0 = chef.x;
                setWish(1, 0);
                window.__sim(30);
                return { dx: chef.x - x0, dy: chef.y - y0 };
            });
            expect(r.dx).toBeGreaterThan(10);
            expect(r.dy).toBe(0);
        });

        test('walking left moves the chef the other way', async ({ page }) => {
            const dx = await page.evaluate(() => {
                startGame();
                const x0 = chef.x;
                setWish(-1, 0);
                window.__sim(30);
                return chef.x - x0;
            });
            expect(dx).toBeLessThan(-10);
        });

        test('the chef cannot walk off the right edge', async ({ page }) => {
            const r = await page.evaluate(() => {
                startGame();
                setWish(1, 0);
                window.__sim(600);
                return { x: chef.x, w: CANVAS_W };
            });
            expect(r.x).toBeLessThanOrEqual(r.w);
            expect(r.x).toBeGreaterThan(r.w - 30);
        });

        test('the chef cannot walk off the left edge', async ({ page }) => {
            const x = await page.evaluate(() => {
                startGame();
                setWish(-1, 0);
                window.__sim(600);
                return chef.x;
            });
            expect(x).toBeGreaterThanOrEqual(0);
            expect(x).toBeLessThan(30);
        });

        test('the chef cannot climb away from a ladder', async ({ page }) => {
            const r = await page.evaluate(() => {
                startGame();
                chef.x = 100; // mid-platform, no ladder in reach
                const y0 = chef.y;
                setWish(0, -1);
                window.__sim(30);
                return { moved: chef.y !== y0, x: chef.x };
            });
            expect(r.moved).toBe(false);
            expect(r.x).toBe(100);
        });

        test('the chef climbs up a ladder and snaps to its centre', async ({ page }) => {
            const r = await page.evaluate(() => {
                startGame();
                chef.x = LADDER_X[2] + 8; // within snap distance
                const y0 = chef.y;
                setWish(0, -1);
                window.__sim(30);
                return { rise: y0 - chef.y, x: chef.x };
            });
            expect(r.rise).toBeGreaterThan(10);
            expect(r.x).toBe(await page.evaluate(() => LADDER_X[2]));
        });

        test('the chef cannot climb above the top floor', async ({ page }) => {
            const r = await page.evaluate(() => {
                startGame();
                setWish(0, -1);
                window.__sim(1200);
                return { y: chef.y, top: FLOOR_Y[0] };
            });
            expect(r.y).toBe(r.top);
        });

        test('the chef cannot climb below the bottom floor', async ({ page }) => {
            const r = await page.evaluate(() => {
                startGame();
                setWish(0, 1);
                window.__sim(300);
                return { y: chef.y, bottom: FLOOR_Y[FLOOR_Y.length - 1] };
            });
            expect(r.y).toBe(r.bottom);
        });

        test('holding a horizontal wish turns the chef off the ladder at a floor', async ({ page }) => {
            const r = await page.evaluate(() => {
                startGame();
                setWish(0, -1);
                window.__sim(20);         // partway up between two floors
                const midY = chef.y;
                setWish(1, 0);
                window.__sim(240);
                return { midY, y: chef.y, x: chef.x, floors: FLOOR_Y };
            });
            expect(r.floors).toContain(r.y);
            expect(r.y).toBeLessThan(r.midY + 1);
            expect(r.x).toBeGreaterThan(await page.evaluate(() => LADDER_X[2]));
        });

        test('the chef does not drift sideways while stopped on a ladder', async ({ page }) => {
            const r = await page.evaluate(() => {
                startGame();
                setWish(1, 0);
                window.__sim(20);          // walk right, so dx is "stale" at 1
                chef.x = LADDER_X[2];
                setWish(0, -1);
                window.__sim(20);          // climb partway up
                setWish(0, 0);
                const x0 = chef.x, y0 = chef.y;
                window.__sim(60);          // let go of everything
                return { dx: chef.x - x0, dy: chef.y - y0, onFloor: floorIndexAt(chef.y) };
            });
            expect(r.dx).toBe(0);
            expect(r.dy).toBe(0);
            expect(r.onFloor).toBe(-1);    // genuinely hanging mid-ladder
        });

        test('the chef faces the direction of travel', async ({ page }) => {
            const facings = await page.evaluate(() => {
                startGame();
                setWish(1, 0); window.__sim(10);
                const right = chef.facing;
                setWish(-1, 0); window.__sim(10);
                return [right, chef.facing];
            });
            expect(facings).toEqual([1, -1]);
        });

        test('arrow keys drive the chef', async ({ page }) => {
            await page.evaluate(() => { startGame(); });
            await page.keyboard.down('ArrowLeft');
            const moved = await page.evaluate(() => {
                const x0 = chef.x;
                window.__sim(30);
                return x0 - chef.x;
            });
            await page.keyboard.up('ArrowLeft');
            expect(moved).toBeGreaterThan(10);
        });
    });

    // -----------------------------------------------------------------------
    // Ingredients
    // -----------------------------------------------------------------------
    test.describe('ingredients', () => {
        test('walking over a segment presses it', async ({ page }) => {
            const segs = await page.evaluate(() => {
                startGame();
                const ing = ingredients.find((i) => i.burger === 1 && i.level === 3);
                chef.x = ing.x + 15;          // centre of segment 0
                chef.y = FLOOR_Y[ing.level];
                window.__sim(1);
                return ing.segs.slice();
            });
            expect(segs).toEqual([true, false, false, false]);
        });

        test('an ingredient on another floor is not pressed', async ({ page }) => {
            const pressed = await page.evaluate(() => {
                startGame();
                const ing = ingredients.find((i) => i.burger === 1 && i.level === 3);
                chef.x = ing.x + 15;
                chef.y = FLOOR_Y[0];          // different floor entirely
                window.__sim(1);
                return ing.segs.some(Boolean);
            });
            expect(pressed).toBe(false);
        });

        test('walking the full width of an ingredient drops it and scores', async ({ page }) => {
            const r = await page.evaluate(() => {
                startGame();
                const ing = ingredients.find((i) => i.burger === 1 && i.level === 3);
                chef.x = ing.x - 5;
                chef.y = FLOOR_Y[ing.level];
                setWish(1, 0);
                window.__sim(180);
                return { falling: ing.falling, level: ing.level, score };
            });
            expect(r.level).toBeGreaterThan(3);
            expect(r.score).toBeGreaterThanOrEqual(50);
        });

        test('a dropped ingredient lands on the floor below and resets its segments', async ({ page }) => {
            const r = await page.evaluate(() => {
                startGame();
                const ing = ingredients.find((i) => i.burger === 2 && i.level === 3);
                ing.segs = [true, true, true, true];
                window.__sim(180);
                return { level: ing.level, falling: ing.falling, segs: ing.segs.slice(), y: ing.y, rest: restY(4, 0) };
            });
            expect(r.level).toBe(4);
            expect(r.falling).toBe(false);
            expect(r.segs).toEqual([false, false, false, false]);
            expect(r.y).toBe(r.rest);
        });

        test('landing on a resting ingredient knocks it loose (chain drop)', async ({ page }) => {
            const r = await page.evaluate(() => {
                startGame();
                const top = ingredients.find((i) => i.burger === 0 && i.level === 2);
                const below = ingredients.find((i) => i.burger === 0 && i.level === 3);
                top.segs = [true, true, true, true];
                window.__sim(60);
                return { topLevel: top.level, belowLevel: below.level, belowFalling: below.falling };
            });
            expect(r.topLevel).toBeGreaterThan(2);
            expect(r.belowLevel > 3 || r.belowFalling).toBe(true);
        });

        test('an ingredient dropped from the bottom floor settles on the plate', async ({ page }) => {
            const r = await page.evaluate(() => {
                startGame();
                const ing = ingredients.find((i) => i.burger === 3 && i.level === 3);
                ing.level = 4;                       // put it on the bottom floor
                ing.y = restY(4, 0);
                ing.segs = [true, true, true, true];
                window.__sim(240);
                return { level: ing.level, falling: ing.falling, plateLevel: PLATE_LEVEL, plateIndex: ing.plateIndex };
            });
            expect(r.level).toBe(r.plateLevel);
            expect(r.falling).toBe(false);
            expect(r.plateIndex).toBe(0);
        });

        test('plate ingredients stack in arrival order', async ({ page }) => {
            const idx = await page.evaluate(() => {
                startGame();
                lives = 99;
                const stack = ingredients.filter((i) => i.burger === 3);
                for (let guard = 0; guard < 40 && stack.some((i) => i.level < PLATE_LEVEL); guard++) {
                    enemies.length = 0;
                    const lowest = stack
                        .filter((i) => i.level < PLATE_LEVEL && !i.falling)
                        .sort((a, b) => b.level - a.level)[0];
                    if (lowest) lowest.segs = [true, true, true, true];
                    window.__sim(120);
                }
                return stack.map((i) => i.plateIndex).sort((a, b) => a - b);
            });
            expect(idx).toEqual([0, 1, 2, 3]);
        });
    });

    // -----------------------------------------------------------------------
    // Completing a stage
    // -----------------------------------------------------------------------
    test.describe('stage completion', () => {
        test('isLevelComplete() is false at the start', async ({ page }) => {
            expect(await page.evaluate(() => { startGame(); return isLevelComplete(); })).toBe(false);
        });

        test('isLevelComplete() is true once every ingredient is plated', async ({ page }) => {
            expect(await page.evaluate(() => {
                startGame();
                ingredients.forEach((i) => { i.level = PLATE_LEVEL; });
                return isLevelComplete();
            })).toBe(true);
        });

        test('clearing a stage awards a bonus, a pepper and advances the level', async ({ page }) => {
            const r = await page.evaluate(() => {
                startGame();
                const pepper0 = pepper;
                ingredients.forEach((i) => { i.level = PLATE_LEVEL; });
                window.__sim(300);
                return { level, pepper, pepper0, score, plated: ingredients.filter((i) => i.level === PLATE_LEVEL).length };
            });
            expect(r.level).toBe(2);
            expect(r.pepper).toBe(r.pepper0 + 1);
            expect(r.score).toBeGreaterThanOrEqual(1000);
            expect(r.plated).toBe(0); // the lattice is rebuilt for the new stage
        });

        test('a new stage rebuilds the burgers on the top four floors', async ({ page }) => {
            const levels = await page.evaluate(() => {
                startGame();
                ingredients.forEach((i) => { i.level = PLATE_LEVEL; });
                window.__sim(300);
                return ingredients.filter((i) => i.burger === 0).map((i) => i.level).sort();
            });
            expect(levels).toEqual([0, 1, 2, 3]);
        });
    });

    // -----------------------------------------------------------------------
    // Enemies
    // -----------------------------------------------------------------------
    test.describe('enemies', () => {
        test('spawnEnemy adds an enemy of the requested type', async ({ page }) => {
            const e = await page.evaluate(() => {
                startGame();
                enemies.length = 0;
                spawnEnemy('pickle', LADDER_X[0], FLOOR_Y[0]);
                return { n: enemies.length, type: enemies[0].type, stun: enemies[0].stun };
            });
            expect(e.n).toBe(1);
            expect(e.type).toBe('pickle');
            expect(e.stun).toBe(0);
        });

        test('enemies spawn over time while the game runs', async ({ page }) => {
            const n = await page.evaluate(() => {
                startGame();
                spawnEnabled = true;
                window.__sim(60 * 12);
                return enemies.length;
            });
            expect(n).toBeGreaterThan(0);
        });

        test('the number of enemies is capped', async ({ page }) => {
            const r = await page.evaluate(() => {
                startGame();
                spawnEnabled = true;
                window.__sim(60 * 90);
                return { n: enemies.length, cap: maxEnemies() };
            });
            expect(r.n).toBeLessThanOrEqual(r.cap);
        });

        test('an enemy walks toward the chef on the same floor', async ({ page }) => {
            const r = await page.evaluate(() => {
                startGame();
                enemies.length = 0;
                chef.x = 300; chef.y = FLOOR_Y[0];
                spawnEnemy('pickle', LADDER_X[0], FLOOR_Y[0]);
                const d0 = Math.abs(enemies[0].x - chef.x);
                window.__sim(60);
                return { d0, d1: Math.abs(enemies[0].x - chef.x) };
            });
            expect(r.d1).toBeLessThan(r.d0);
        });

        test('an enemy climbs toward a chef on a lower floor', async ({ page }) => {
            const dy = await page.evaluate(() => {
                startGame();
                enemies.length = 0;
                chef.x = LADDER_X[0]; chef.y = FLOOR_Y[4];
                spawnEnemy('hotdog', LADDER_X[0], FLOOR_Y[0]);
                const y0 = enemies[0].y;
                window.__sim(120);
                return enemies[0].y - y0;
            });
            expect(dy).toBeGreaterThan(10);
        });

        test('enemies stay inside the lattice', async ({ page }) => {
            const ok = await page.evaluate(() => {
                startGame();
                spawnEnabled = true;
                window.__sim(60 * 60);
                return enemies.every((e) =>
                    e.x >= 0 && e.x <= CANVAS_W && e.y >= FLOOR_Y[0] && e.y <= FLOOR_Y[FLOOR_Y.length - 1]);
            });
            expect(ok).toBe(true);
        });

        test('touching an enemy costs a life and resets the chef', async ({ page }) => {
            const r = await page.evaluate(() => {
                startGame();
                enemies.length = 0;
                chef.x = 300; chef.y = FLOOR_Y[2];
                spawnEnemy('egg', 302, FLOOR_Y[2]);
                window.__sim(1);
                return { lives, enemies: enemies.length, x: chef.x, y: chef.y, startY: FLOOR_Y[4] };
            });
            expect(r.lives).toBe(2);
            expect(r.enemies).toBe(0);
            expect(r.y).toBe(r.startY);
        });

        test('ingredient progress survives losing a life', async ({ page }) => {
            const levels = await page.evaluate(() => {
                startGame();
                enemies.length = 0;
                const ing = ingredients.find((i) => i.burger === 2 && i.level === 3);
                ing.level = PLATE_LEVEL;
                chef.x = 300; chef.y = FLOOR_Y[2];
                spawnEnemy('egg', 300, FLOOR_Y[2]);
                window.__sim(1);
                return ing.level;
            });
            expect(levels).toBe(await page.evaluate(() => PLATE_LEVEL));
        });

        test('losing the last life ends the game', async ({ page }) => {
            const r = await page.evaluate(() => {
                startGame();
                lives = 1;
                enemies.length = 0;
                chef.x = 300; chef.y = FLOOR_Y[2];
                spawnEnemy('egg', 300, FLOOR_Y[2]);
                window.__sim(1);
                return { state, lives };
            });
            expect(r.state).toBe('over');
            expect(r.lives).toBe(0);
            await expect(page.locator('#overlay')).toHaveClass(/visible/);
            await expect(page.locator('#overlay-title')).toContainText(/over/i);
        });

        test('a falling ingredient squashes an enemy', async ({ page }) => {
            const r = await page.evaluate(() => {
                startGame();
                enemies.length = 0;
                chef.x = 20; chef.y = FLOOR_Y[4];
                const ing = ingredients.find((i) => i.burger === 3 && i.level === 3);
                spawnEnemy('pickle', ing.x + 60, FLOOR_Y[4]);
                const before = score;
                ing.segs = [true, true, true, true];
                window.__sim(180);
                return { n: enemies.length, gain: score - before };
            });
            expect(r.n).toBe(0);
            expect(r.gain).toBeGreaterThanOrEqual(500);
        });
    });

    // -----------------------------------------------------------------------
    // Pepper
    // -----------------------------------------------------------------------
    test.describe('pepper', () => {
        test('spraying spends a pepper and makes a cloud', async ({ page }) => {
            const r = await page.evaluate(() => {
                startGame();
                spray();
                return { pepper, clouds: peppers.length };
            });
            expect(r.pepper).toBe(4);
            expect(r.clouds).toBe(1);
        });

        test('spraying with no pepper left does nothing', async ({ page }) => {
            const r = await page.evaluate(() => {
                startGame();
                pepper = 0;
                spray();
                return { pepper, clouds: peppers.length };
            });
            expect(r.pepper).toBe(0);
            expect(r.clouds).toBe(0);
        });

        test('the HUD shows the remaining pepper', async ({ page }) => {
            await page.evaluate(() => { startGame(); spray(); });
            await expect(page.locator('#pepper')).toHaveText('4');
        });

        test('a cloud stuns an enemy in front of the chef', async ({ page }) => {
            const stun = await page.evaluate(() => {
                startGame();
                enemies.length = 0;
                chef.x = 300; chef.y = FLOOR_Y[2]; chef.facing = 1;
                spawnEnemy('hotdog', 325, FLOOR_Y[2]);
                spray();
                window.__sim(1);
                return enemies[0].stun;
            });
            expect(stun).toBeGreaterThan(0);
        });

        test('a stunned enemy does not move', async ({ page }) => {
            const moved = await page.evaluate(() => {
                startGame();
                enemies.length = 0;
                chef.x = 100; chef.y = FLOOR_Y[0];
                spawnEnemy('hotdog', 400, FLOOR_Y[0]);
                enemies[0].stun = 5;
                const x0 = enemies[0].x;
                window.__sim(60);
                return Math.abs(enemies[0].x - x0);
            });
            expect(moved).toBe(0);
        });

        test('a stunned enemy is harmless', async ({ page }) => {
            const remaining = await page.evaluate(() => {
                startGame();
                enemies.length = 0;
                chef.x = 300; chef.y = FLOOR_Y[2];
                spawnEnemy('hotdog', 300, FLOOR_Y[2]);
                enemies[0].stun = 5;
                window.__sim(30);
                return lives;
            });
            expect(remaining).toBe(3);
        });

        test('stun wears off', async ({ page }) => {
            const stun = await page.evaluate(() => {
                startGame();
                enemies.length = 0;
                chef.x = 20; chef.y = FLOOR_Y[4];
                spawnEnemy('hotdog', 400, FLOOR_Y[0]);
                enemies[0].stun = 0.5;
                window.__sim(60);
                return enemies[0].stun;
            });
            expect(stun).toBe(0);
        });

        test('Space throws pepper while the game is running', async ({ page }) => {
            await page.evaluate(() => { startGame(); });
            await page.keyboard.press('Space');
            expect(await page.evaluate(() => pepper)).toBe(4);
        });
    });

    // -----------------------------------------------------------------------
    // Pause, game over, restart, persistence
    // -----------------------------------------------------------------------
    test.describe('flow control', () => {
        test('P pauses and resumes the game', async ({ page }) => {
            await page.evaluate(() => { startGame(); });
            await page.keyboard.press('p');
            expect(await page.evaluate(() => state)).toBe('paused');
            await page.keyboard.press('p');
            expect(await page.evaluate(() => state)).toBe('running');
        });

        test('the simulation does not advance while paused', async ({ page }) => {
            const moved = await page.evaluate(() => {
                startGame();
                setWish(1, 0);
                state = 'paused';
                const x0 = chef.x;
                window.__sim(60);
                return chef.x - x0;
            });
            expect(moved).toBe(0);
        });

        test('Space resumes a paused game instead of restarting it', async ({ page }) => {
            await page.evaluate(() => { startGame(); score = 700; });
            await page.keyboard.press('p');
            await page.keyboard.press('Space');
            const r = await page.evaluate(() => ({ state, score }));
            expect(r).toEqual({ state: 'running', score: 700 });
        });

        test('Space restarts after a game over', async ({ page }) => {
            await page.evaluate(() => { startGame(); score = 500; lives = 0; gameOver(); });
            expect(await page.evaluate(() => state)).toBe('over');
            await page.keyboard.press('Space');
            const r = await page.evaluate(() => ({ state, score, lives }));
            expect(r).toEqual({ state: 'running', score: 0, lives: 3 });
        });

        test('the best score is persisted on game over', async ({ page }) => {
            const best = await page.evaluate(() => {
                startGame();
                score = 3210;
                gameOver();
                return window.localStorage.getItem('burgertime-best');
            });
            expect(best).toBe('3210');
            await expect(page.locator('#best')).toHaveText('3210');
        });

        test('a lower score does not overwrite the best', async ({ page }) => {
            const best = await page.evaluate(() => {
                window.localStorage.setItem('burgertime-best', '9000');
                loadBest();
                startGame();
                score = 10;
                gameOver();
                return window.localStorage.getItem('burgertime-best');
            });
            expect(best).toBe('9000');
        });

        test('the HUD tracks score and lives', async ({ page }) => {
            await page.evaluate(() => {
                startGame();
                score = 1234; lives = 2;
                updateHud();
            });
            await expect(page.locator('#score')).toHaveText('1234');
            await expect(page.locator('#lives')).toHaveText('2');
        });
    });

    // -----------------------------------------------------------------------
    // A full stage, played through the real controls
    // -----------------------------------------------------------------------
    test.describe('playthrough', () => {
        test('a stage can be cleared by walking the lattice', async ({ page }) => {
            const r = await page.evaluate(() => {
                startGame();
                spawnEnabled = false;    // this test is about the burgers, not the chase

                // Simplest possible bot: always work on the ingredient closest
                // to the plates, climb to its floor, then walk over the first
                // segment it has not trodden yet.
                const nextTarget = () => ingredients
                    .filter((i) => i.level < PLATE_LEVEL && !i.falling)
                    .sort((a, b) => b.level - a.level || a.burger - b.burger)[0] || null;

                let frames = 0;
                const CAP = 60 * 300;
                while (level === 1 && frames < CAP) {
                    const t = nextTarget();
                    if (!t) {
                        setWish(0, 0);
                    } else if (floorIndexAt(chef.y) !== t.level) {
                        const lx = ladderXNear(chef.x);
                        if (lx === null && floorIndexAt(chef.y) >= 0) {
                            let nearest = LADDER_X[0];
                            for (const x of LADDER_X) {
                                if (Math.abs(x - chef.x) < Math.abs(nearest - chef.x)) nearest = x;
                            }
                            setWish(nearest > chef.x ? 1 : -1, 0);
                        } else {
                            setWish(0, FLOOR_Y[t.level] > chef.y ? 1 : -1);
                        }
                    } else {
                        const seg = t.segs.findIndex((s) => !s);
                        const tx = t.x + seg * SEG_W + SEG_W / 2;
                        setWish(Math.abs(tx - chef.x) < 1.5 ? 0 : (tx > chef.x ? 1 : -1), 0);
                    }
                    step(1 / 60);
                    frames += 1;
                }
                return { level, frames, score, seconds: Math.round(frames / 60) };
            });
            expect(r.level).toBe(2);          // the stage was cleared and rolled over
            expect(r.score).toBeGreaterThan(1000);
        });
    });

    // -----------------------------------------------------------------------
    // The real animation loop (every other test drives step() by hand)
    // -----------------------------------------------------------------------
    test.describe('animation loop', () => {
        test('the game runs and spawns from requestAnimationFrame', async ({ page }) => {
            await page.evaluate(() => { autoStep = true; spawnEnabled = true; startGame(); });
            await page.keyboard.down('ArrowLeft');
            await page.waitForTimeout(2600);   // past the first spawn timer
            await page.keyboard.up('ArrowLeft');
            const r = await page.evaluate(() => ({ x: chef.x, start: LADDER_X[2], enemies: enemies.length, state }));
            expect(r.x).toBeLessThan(r.start - 20);
            expect(r.enemies).toBeGreaterThan(0);
            expect(['running', 'over']).toContain(r.state);
        });
    });

    // -----------------------------------------------------------------------
    // Determinism
    // -----------------------------------------------------------------------
    test.describe('determinism', () => {
        test('the same seed produces the same enemy positions', async ({ page }) => {
            const run = () => page.evaluate(() => {
                seedRng(7);
                startGame();
                spawnEnabled = true;
                window.__sim(60 * 10);
                return enemies.map((e) => [Math.round(e.x), Math.round(e.y)]);
            });
            const a = await run();
            const b = await run();
            expect(a).toEqual(b);
            expect(a.length).toBeGreaterThan(0);
        });
    });
});

// ---------------------------------------------------------------------------
// Integration with the game browser
// ---------------------------------------------------------------------------
test.describe('game browser integration', () => {
    const gamesJson = path.resolve(__dirname, '../../game-browser/src/assets/games.json');

    test('BurgerTime is listed in the browser catalogue', () => {
        const games = JSON.parse(fs.readFileSync(gamesJson, 'utf8'));
        const entry = games.find((g) => g.dir === 'BurgerTime');
        expect(entry).toBeTruthy();
        expect(entry.id).toBe('burger-time');
        expect(entry.path).toBe('games/BurgerTime/index.html');
        expect(entry.category).toBe('Action');
        expect(entry.description.length).toBeGreaterThan(10);
    });

    test('the catalogue has no duplicate ids', () => {
        const games = JSON.parse(fs.readFileSync(gamesJson, 'utf8'));
        expect(new Set(games.map((g) => g.id)).size).toBe(games.length);
    });

    test('BurgerTime is listed in the repo README', () => {
        const readme = fs.readFileSync(path.resolve(__dirname, '../../README.md'), 'utf8');
        expect(readme).toMatch(/\|\s*BurgerTime\s*\|\s*\[BurgerTime\/\]\(BurgerTime\/\)\s*\|/);
    });
});
