const { test, expect } = require('@playwright/test');
const path = require('path');
const { pathToFileURL } = require('url');

const GAME_URL = pathToFileURL(path.resolve(__dirname, '../index.html')).href;

test.describe('Burger Chef', () => {
    test.beforeEach(async ({ page }) => {
        await page.goto(GAME_URL);
    });

    // -----------------------------------------------------------------------
    // Initial / idle state
    // -----------------------------------------------------------------------
    test.describe('initial state', () => {
        test('page title is Burger Chef', async ({ page }) => {
            await expect(page).toHaveTitle('Burger Chef');
        });

        test('canvas is 640x500', async ({ page }) => {
            const canvas = page.locator('#canvas');
            await expect(canvas).toHaveAttribute('width', '640');
            await expect(canvas).toHaveAttribute('height', '500');
        });

        test('start overlay is visible', async ({ page }) => {
            await expect(page.locator('#overlay')).toHaveClass(/visible/);
        });

        test('overlay prompts the player to start', async ({ page }) => {
            await expect(page.locator('#overlay-sub')).toContainText(/space|start/i);
        });

        test('state is idle before starting', async ({ page }) => {
            expect(await page.evaluate(() => state)).toBe('idle');
        });

        test('HUD starts at zero score, level 1, 3 lives', async ({ page }) => {
            await expect(page.locator('#score')).toHaveText('0');
            await expect(page.locator('#level')).toHaveText('1');
            await expect(page.locator('#lives')).toHaveText('3');
        });

        test('best score loads from localStorage', async ({ page }) => {
            await page.evaluate(() => window.localStorage.setItem('burgerchef-best', '4200'));
            await page.reload();
            await expect(page.locator('#best')).toHaveText('4200');
        });

        test('there are five floors and the plate floor is the lowest', async ({ page }) => {
            const info = await page.evaluate(() => ({ n: FLOOR_Y.length, plate: PLATE_FLOOR, ys: FLOOR_Y }));
            expect(info.n).toBe(5);
            expect(info.plate).toBe(4);
            // floors run top (small y) to bottom (large y)
            for (let i = 1; i < info.ys.length; i++) {
                expect(info.ys[i]).toBeGreaterThan(info.ys[i - 1]);
            }
        });

        test('board has three burger stacks of four ingredients', async ({ page }) => {
            const info = await page.evaluate(() => ({
                stacks: STACK_X.length,
                total: ingredients.length,
                types: INGREDIENT_TYPES.length,
            }));
            expect(info.stacks).toBe(3);
            expect(info.types).toBe(4);
            expect(info.total).toBe(12);
        });

        test('each ingredient starts on its own floor with no segments flipped', async ({ page }) => {
            const ok = await page.evaluate(() => ingredients.every(
                (ing) => ing.floor === ing.type && ing.flipped.every((f) => f === false) && !ing.falling && !ing.served,
            ));
            expect(ok).toBe(true);
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

        test('a fresh game has level 1, 3 lives and a clean score', async ({ page }) => {
            const s = await page.evaluate(() => { startGame(); return { level, lives, score }; });
            expect(s.level).toBe(1);
            expect(s.lives).toBe(3);
            expect(s.score).toBe(0);
        });

        test('pepper supply starts at PEPPER_START', async ({ page }) => {
            const s = await page.evaluate(() => { startGame(); return { peppers, start: PEPPER_START }; });
            expect(s.peppers).toBe(s.start);
            expect(s.start).toBeGreaterThan(0);
        });

        test('the chef starts standing on the plate floor', async ({ page }) => {
            const c = await page.evaluate(() => { startGame(); return { floor: chef.floor, y: chef.y, py: FLOOR_Y[PLATE_FLOOR], climbing: chef.climbing }; });
            expect(c.floor).toBe(4);
            expect(c.y).toBe(c.py);
            expect(c.climbing).toBe(false);
        });

        test('enemies are on the board once the game starts', async ({ page }) => {
            const n = await page.evaluate(() => { startGame(); return enemies.length; });
            expect(n).toBeGreaterThan(0);
        });
    });

    // -----------------------------------------------------------------------
    // Chef movement
    // -----------------------------------------------------------------------
    test.describe('chef movement', () => {
        test('walking right increases x', async ({ page }) => {
            const d = await page.evaluate(() => {
                startGame(); setChef(300, 4);
                const before = chef.x;
                moveChef(1, 0);
                for (let i = 0; i < 20; i++) step(0.016);
                return { before, after: chef.x };
            });
            expect(d.after).toBeGreaterThan(d.before);
        });

        test('walking left decreases x', async ({ page }) => {
            const d = await page.evaluate(() => {
                startGame(); setChef(300, 4);
                const before = chef.x;
                moveChef(-1, 0);
                for (let i = 0; i < 20; i++) step(0.016);
                return { before, after: chef.x };
            });
            expect(d.after).toBeLessThan(d.before);
        });

        test('the chef cannot walk off the left edge', async ({ page }) => {
            const x = await page.evaluate(() => {
                startGame(); setChef(60, 4);
                moveChef(-1, 0);
                for (let i = 0; i < 300; i++) step(0.016);
                return chef.x;
            });
            expect(x).toBeGreaterThanOrEqual(0);
        });

        test('the chef cannot walk off the right edge', async ({ page }) => {
            const d = await page.evaluate(() => {
                startGame(); setChef(600, 4);
                moveChef(1, 0);
                for (let i = 0; i < 300; i++) step(0.016);
                return { x: chef.x, w: CANVAS_W };
            });
            expect(d.x).toBeLessThanOrEqual(d.w);
        });

        test('climbing up a ladder raises the chef and changes floor', async ({ page }) => {
            const d = await page.evaluate(() => {
                startGame(); setChef(LADDER_X[1], 4);
                const before = chef.y;
                moveChef(0, -1);
                for (let i = 0; i < 200; i++) step(0.016);
                moveChef(0, 0);
                step(0.016);
                return { before, after: chef.y, floor: chef.floor };
            });
            expect(d.after).toBeLessThan(d.before);
            expect(d.floor).toBeLessThan(4);
        });

        test('climbing snaps the chef onto the ladder centre line', async ({ page }) => {
            const x = await page.evaluate(() => {
                startGame(); setChef(LADDER_X[1] + 6, 4);
                moveChef(0, -1);
                for (let i = 0; i < 10; i++) step(0.016);
                return chef.x;
            });
            expect(x).toBe(await page.evaluate(() => LADDER_X[1]));
        });

        test('the chef cannot climb where there is no ladder', async ({ page }) => {
            const d = await page.evaluate(() => {
                startGame(); setChef(300, 4);
                const before = chef.y;
                moveChef(0, -1);
                for (let i = 0; i < 60; i++) step(0.016);
                return { before, after: chef.y };
            });
            expect(d.after).toBe(d.before);
        });

        test('the chef cannot climb above the top floor', async ({ page }) => {
            const d = await page.evaluate(() => {
                startGame(); setChef(LADDER_X[0], 0);
                moveChef(0, -1);
                for (let i = 0; i < 200; i++) step(0.016);
                return { y: chef.y, top: FLOOR_Y[0] };
            });
            expect(d.y).toBe(d.top);
        });

        test('the chef cannot climb below the plate floor', async ({ page }) => {
            const d = await page.evaluate(() => {
                startGame(); setChef(LADDER_X[0], PLATE_FLOOR);
                moveChef(0, 1);
                for (let i = 0; i < 200; i++) step(0.016);
                return { y: chef.y, bottom: FLOOR_Y[PLATE_FLOOR] };
            });
            expect(d.y).toBe(d.bottom);
        });

        test('stepping down a ladder lands the chef on the next floor', async ({ page }) => {
            const d = await page.evaluate(() => {
                startGame(); setChef(LADDER_X[2], 1);
                moveChef(0, 1);
                for (let i = 0; i < 400; i++) { step(0.016); if (chef.y >= FLOOR_Y[2]) break; }
                moveChef(0, 0);
                step(0.016);
                return { floor: chef.floor, y: chef.y, target: FLOOR_Y[2] };
            });
            expect(d.floor).toBeGreaterThanOrEqual(2);
            expect(Math.abs(d.y - d.target)).toBeLessThanOrEqual(6);
        });
    });

    // -----------------------------------------------------------------------
    // Walking ingredients
    // -----------------------------------------------------------------------
    test.describe('ingredients', () => {
        test('walking over a segment flips it', async ({ page }) => {
            const flipped = await page.evaluate(() => {
                startGame();
                enemies.length = 0;
                const ing = getIngredient(0, 0);
                setChef(STACK_X[0] + SEG_W / 2, ing.floor);
                step(0.016);
                return ing.flipped.slice();
            });
            expect(flipped[0]).toBe(true);
            expect(flipped[1]).toBe(false);
        });

        test('an ingredient on another floor is not flipped', async ({ page }) => {
            const flipped = await page.evaluate(() => {
                startGame();
                enemies.length = 0;
                const ing = getIngredient(0, 1); // sits one floor lower
                setChef(STACK_X[0] + SEG_W / 2, 0);
                step(0.016);
                return ing.flipped.slice();
            });
            expect(flipped.every((f) => f === false)).toBe(true);
        });

        test('flipping all four segments makes the ingredient fall', async ({ page }) => {
            const falling = await page.evaluate(() => {
                startGame();
                enemies.length = 0;
                const ing = getIngredient(0, 0);
                for (let s = 0; s < SEGS; s++) {
                    setChef(STACK_X[0] + s * SEG_W + SEG_W / 2, ing.floor);
                    step(0.001);
                }
                return ing.falling;
            });
            expect(falling).toBe(true);
        });

        test('dropping an ingredient scores points', async ({ page }) => {
            const d = await page.evaluate(() => {
                startGame();
                enemies.length = 0;
                const before = score;
                const ing = getIngredient(0, 3); // bottom ingredient, nothing under it
                for (let s = 0; s < SEGS; s++) {
                    setChef(STACK_X[0] + s * SEG_W + SEG_W / 2, ing.floor);
                    step(0.001);
                }
                return { before, after: score };
            });
            expect(d.after).toBeGreaterThan(d.before);
        });

        test('a dropped ingredient with clear space below lands one floor lower', async ({ page }) => {
            const d = await page.evaluate(() => {
                startGame();
                enemies.length = 0;
                const ing = getIngredient(2, 0);
                // clear the floors below so nothing cascades
                for (const o of ingredients) if (o.stack === 2 && o !== ing) o.served = true;
                const from = ing.floor;
                for (let s = 0; s < SEGS; s++) {
                    setChef(STACK_X[2] + s * SEG_W + SEG_W / 2, ing.floor);
                    step(0.001);
                }
                setChef(600, 4);
                for (let i = 0; i < 200; i++) { step(0.016); if (!ing.falling) break; }
                return { from, to: ing.floor, falling: ing.falling };
            });
            expect(d.falling).toBe(false);
            expect(d.to).toBe(d.from + 1);
        });

        test('segments reset after the ingredient lands', async ({ page }) => {
            const flipped = await page.evaluate(() => {
                startGame();
                enemies.length = 0;
                const ing = getIngredient(2, 0);
                for (const o of ingredients) if (o.stack === 2 && o !== ing) o.served = true;
                for (let s = 0; s < SEGS; s++) {
                    setChef(STACK_X[2] + s * SEG_W + SEG_W / 2, ing.floor);
                    step(0.001);
                }
                setChef(600, 4);
                for (let i = 0; i < 200; i++) { step(0.016); if (!ing.falling) break; }
                return ing.flipped.slice();
            });
            expect(flipped.every((f) => f === false)).toBe(true);
        });

        test('landing on another ingredient knocks it down too (cascade)', async ({ page }) => {
            const d = await page.evaluate(() => {
                startGame();
                enemies.length = 0;
                const top = getIngredient(1, 0);
                const next = getIngredient(1, 1);
                for (const o of ingredients) if (o.stack === 1 && o !== top && o !== next) o.served = true;
                for (let s = 0; s < SEGS; s++) {
                    setChef(STACK_X[1] + s * SEG_W + SEG_W / 2, top.floor);
                    step(0.001);
                }
                setChef(600, 4);
                for (let i = 0; i < 400; i++) { step(0.016); if (!top.falling && !next.falling) break; }
                return { top: top.floor, next: next.floor };
            });
            // the top bun knocked the next ingredient from floor 1 down to floor 2
            expect(d.next).toBe(2);
            expect(d.top).toBe(2);
        });

        test('an ingredient reaching the plate floor is served', async ({ page }) => {
            const d = await page.evaluate(() => {
                startGame();
                enemies.length = 0;
                const ing = getIngredient(0, 3);
                for (const o of ingredients) if (o.stack === 0 && o !== ing) o.served = true;
                for (let s = 0; s < SEGS; s++) {
                    setChef(STACK_X[0] + s * SEG_W + SEG_W / 2, ing.floor);
                    step(0.001);
                }
                setChef(600, 4);
                for (let i = 0; i < 400; i++) { step(0.016); if (ing.served) break; }
                return { served: ing.served, floor: ing.floor, plate: plates[0].length };
            });
            expect(d.served).toBe(true);
            expect(d.floor).toBe(4);
            expect(d.plate).toBeGreaterThan(0);
        });

        test('a full cascade from the top bun completes the burger', async ({ page }) => {
            const d = await page.evaluate(() => {
                startGame();
                enemies.length = 0;
                const top = getIngredient(0, 0);
                for (let s = 0; s < SEGS; s++) {
                    setChef(STACK_X[0] + s * SEG_W + SEG_W / 2, top.floor);
                    step(0.001);
                }
                setChef(600, 4);
                for (let i = 0; i < 800; i++) { step(0.016); if (plates[0].length === 4) break; }
                return { plate: plates[0].length, done: burgerComplete(0) };
            });
            expect(d.plate).toBe(4);
            expect(d.done).toBe(true);
        });

        test('completing every burger advances to the next level', async ({ page }) => {
            const d = await page.evaluate(() => {
                startGame();
                enemies.length = 0;
                const before = score;
                for (let stack = 0; stack < STACK_X.length; stack++) {
                    const top = getIngredient(stack, 0);
                    for (let s = 0; s < SEGS; s++) {
                        setChef(STACK_X[stack] + s * SEG_W + SEG_W / 2, top.floor);
                        step(0.001);
                    }
                    setChef(600, 4);
                    for (let i = 0; i < 800; i++) { step(0.016); if (plates[stack].length === 4) break; }
                }
                for (let i = 0; i < 20; i++) step(0.016);
                return { level, before, after: score, served: ingredients.filter((o) => o.served).length };
            });
            expect(d.level).toBe(2);
            expect(d.after).toBeGreaterThan(d.before);
            // the board is rebuilt for the new level
            expect(d.served).toBe(0);
        });
    });

    // -----------------------------------------------------------------------
    // Pepper
    // -----------------------------------------------------------------------
    test.describe('pepper', () => {
        test('spraying uses one pepper', async ({ page }) => {
            const d = await page.evaluate(() => {
                startGame(); setChef(300, 4);
                const before = peppers;
                sprayPepper();
                return { before, after: peppers };
            });
            expect(d.after).toBe(d.before - 1);
        });

        test('spraying stuns an enemy in front of the chef', async ({ page }) => {
            const stun = await page.evaluate(() => {
                startGame(); setChef(300, 4);
                enemies.length = 0;
                const e = spawnEnemy(326, 4);
                moveChef(1, 0);
                sprayPepper();
                return e.stun;
            });
            expect(stun).toBeGreaterThan(0);
        });

        test('spraying does not stun an enemy behind the chef', async ({ page }) => {
            const stun = await page.evaluate(() => {
                startGame(); setChef(300, 4);
                enemies.length = 0;
                const e = spawnEnemy(260, 4);
                moveChef(1, 0);
                sprayPepper();
                return e.stun;
            });
            expect(stun).toBe(0);
        });

        test('spraying does not stun an enemy on another floor', async ({ page }) => {
            const stun = await page.evaluate(() => {
                startGame(); setChef(300, 4);
                enemies.length = 0;
                const e = spawnEnemy(326, 2);
                moveChef(1, 0);
                sprayPepper();
                return e.stun;
            });
            expect(stun).toBe(0);
        });

        test('spraying with no pepper left does nothing', async ({ page }) => {
            const d = await page.evaluate(() => {
                startGame(); setChef(300, 4);
                peppers = 0;
                const ok = sprayPepper();
                return { ok, peppers };
            });
            expect(d.ok).toBe(false);
            expect(d.peppers).toBe(0);
        });

        test('a stunned enemy cannot hurt the chef', async ({ page }) => {
            const d = await page.evaluate(() => {
                startGame(); setChef(300, 4);
                enemies.length = 0;
                const e = spawnEnemy(304, 4);
                e.stun = 2;
                const before = lives;
                for (let i = 0; i < 10; i++) step(0.016);
                return { before, after: lives };
            });
            expect(d.after).toBe(d.before);
        });

        test('a stun wears off over time', async ({ page }) => {
            const d = await page.evaluate(() => {
                startGame(); setChef(40, 0);
                enemies.length = 0;
                const e = spawnEnemy(600, 4);
                e.stun = 0.5;
                for (let i = 0; i < 60; i++) step(0.016);
                return e.stun;
            });
            expect(d).toBe(0);
        });
    });

    // -----------------------------------------------------------------------
    // Enemies
    // -----------------------------------------------------------------------
    test.describe('enemies', () => {
        test('an enemy on the same floor walks toward the chef', async ({ page }) => {
            const d = await page.evaluate(() => {
                startGame(); setChef(100, 4);
                enemies.length = 0;
                const e = spawnEnemy(500, 4);
                const before = e.x;
                for (let i = 0; i < 30; i++) step(0.016);
                return { before, after: e.x };
            });
            expect(d.after).toBeLessThan(d.before);
        });

        test('an enemy on a lower floor climbs toward the chef', async ({ page }) => {
            const d = await page.evaluate(() => {
                startGame(); setChef(LADDER_X[0], 0);
                enemies.length = 0;
                const e = spawnEnemy(LADDER_X[0], 4);
                const before = e.y;
                for (let i = 0; i < 300; i++) step(0.016);
                return { before, after: e.y };
            });
            expect(d.after).toBeLessThan(d.before);
        });

        test('an enemy walks to a ladder when it needs to change floor', async ({ page }) => {
            const d = await page.evaluate(() => {
                startGame(); setChef(LADDER_X[0], 0);
                enemies.length = 0;
                const e = spawnEnemy(320, 4);
                const before = Math.min(...LADDER_X.map((lx) => Math.abs(lx - e.x)));
                for (let i = 0; i < 60; i++) step(0.016);
                const after = Math.min(...LADDER_X.map((lx) => Math.abs(lx - e.x)));
                return { before, after };
            });
            expect(d.after).toBeLessThan(d.before);
        });

        test('touching an enemy costs a life', async ({ page }) => {
            const d = await page.evaluate(() => {
                startGame(); setChef(300, 4);
                enemies.length = 0;
                spawnEnemy(302, 4);
                const before = lives;
                for (let i = 0; i < 5; i++) step(0.016);
                return { before, after: lives };
            });
            expect(d.after).toBe(d.before - 1);
        });

        test('losing a life resets the chef to the start position', async ({ page }) => {
            const d = await page.evaluate(() => {
                startGame(); setChef(300, 4);
                enemies.length = 0;
                spawnEnemy(302, 4);
                for (let i = 0; i < 5; i++) step(0.016);
                return { x: chef.x, floor: chef.floor, start: CHEF_START_X };
            });
            expect(d.x).toBe(d.start);
            expect(d.floor).toBe(4);
        });

        test('losing a life keeps the ingredients already served', async ({ page }) => {
            const d = await page.evaluate(() => {
                startGame();
                enemies.length = 0;
                const ing = getIngredient(0, 3);
                for (const o of ingredients) if (o.stack === 0 && o !== ing) o.served = true;
                for (let s = 0; s < SEGS; s++) {
                    setChef(STACK_X[0] + s * SEG_W + SEG_W / 2, ing.floor);
                    step(0.001);
                }
                setChef(600, 4);
                for (let i = 0; i < 400; i++) { step(0.016); if (ing.served) break; }
                const servedBefore = plates[0].length;
                enemies.length = 0;
                setChef(300, 4);
                spawnEnemy(302, 4);
                for (let i = 0; i < 5; i++) step(0.016);
                return { servedBefore, servedAfter: plates[0].length };
            });
            expect(d.servedAfter).toBe(d.servedBefore);
        });

        test('running out of lives ends the game', async ({ page }) => {
            const s = await page.evaluate(() => {
                startGame();
                lives = 1;
                setChef(300, 4);
                enemies.length = 0;
                spawnEnemy(302, 4);
                for (let i = 0; i < 5; i++) step(0.016);
                return { state, lives };
            });
            expect(s.state).toBe('over');
            expect(s.lives).toBe(0);
        });

        test('game over shows the overlay', async ({ page }) => {
            await page.evaluate(() => {
                startGame();
                lives = 1;
                setChef(300, 4);
                enemies.length = 0;
                spawnEnemy(302, 4);
                for (let i = 0; i < 5; i++) step(0.016);
            });
            await expect(page.locator('#overlay')).toHaveClass(/visible/);
            await expect(page.locator('#overlay-title')).toContainText(/game over/i);
        });

        test('a falling ingredient squashes an enemy underneath it', async ({ page }) => {
            const d = await page.evaluate(() => {
                startGame();
                const ing = getIngredient(0, 0);
                for (const o of ingredients) if (o.stack === 0 && o !== ing) o.served = true;
                enemies.length = 0;
                const e = spawnEnemy(STACK_X[0] + 40, 1); // directly below the top bun
                const before = score;
                for (let s = 0; s < SEGS; s++) {
                    setChef(STACK_X[0] + s * SEG_W + SEG_W / 2, ing.floor);
                    step(0.001);
                }
                setChef(600, 4);
                for (let i = 0; i < 200; i++) { step(0.016); if (!e.alive) break; }
                return { alive: e.alive, before, after: score };
            });
            expect(d.alive).toBe(false);
            expect(d.after).toBeGreaterThan(d.before);
        });

        test('a squashed enemy rides the ingredient an extra floor down', async ({ page }) => {
            const d = await page.evaluate(() => {
                startGame();
                const ing = getIngredient(0, 0);
                for (const o of ingredients) if (o.stack === 0 && o !== ing) o.served = true;
                enemies.length = 0;
                spawnEnemy(STACK_X[0] + 40, 1);
                for (let s = 0; s < SEGS; s++) {
                    setChef(STACK_X[0] + s * SEG_W + SEG_W / 2, ing.floor);
                    step(0.001);
                }
                setChef(600, 4);
                for (let i = 0; i < 400; i++) { step(0.016); if (!ing.falling) break; }
                return ing.floor;
            });
            expect(d).toBe(2);
        });

        test('a squashed enemy comes back after a delay', async ({ page }) => {
            const d = await page.evaluate(() => {
                startGame(); setChef(40, 0);
                enemies.length = 0;
                const e = spawnEnemy(600, 4);
                e.alive = false;
                e.respawn = 0.5;
                for (let i = 0; i < 60; i++) step(0.016);
                return e.alive;
            });
            expect(d).toBe(true);
        });
    });

    // -----------------------------------------------------------------------
    // Pause / flow
    // -----------------------------------------------------------------------
    test.describe('pause', () => {
        test('P pauses a running game', async ({ page }) => {
            await page.evaluate(() => startGame());
            await page.keyboard.press('p');
            expect(await page.evaluate(() => state)).toBe('paused');
            await expect(page.locator('#overlay')).toHaveClass(/visible/);
        });

        test('stepping while paused changes nothing', async ({ page }) => {
            const d = await page.evaluate(() => {
                startGame(); setChef(300, 4);
                togglePause();
                const before = chef.x;
                moveChef(1, 0);
                for (let i = 0; i < 30; i++) step(0.016);
                return { before, after: chef.x };
            });
            expect(d.after).toBe(d.before);
        });

        test('P resumes a paused game', async ({ page }) => {
            await page.evaluate(() => { startGame(); togglePause(); });
            await page.keyboard.press('p');
            expect(await page.evaluate(() => state)).toBe('running');
            await expect(page.locator('#overlay')).not.toHaveClass(/visible/);
        });
    });

    // -----------------------------------------------------------------------
    // Scoring / persistence
    // -----------------------------------------------------------------------
    test.describe('scoring', () => {
        test('the HUD reflects the current score', async ({ page }) => {
            await page.evaluate(() => {
                startGame();
                score = 1234;
                updateHud();
            });
            await expect(page.locator('#score')).toHaveText('1234');
        });

        test('the best score is stored when the game ends', async ({ page }) => {
            const best = await page.evaluate(() => {
                startGame();
                score = 777;
                lives = 1;
                setChef(300, 4);
                enemies.length = 0;
                spawnEnemy(302, 4);
                for (let i = 0; i < 5; i++) step(0.016);
                return window.localStorage.getItem('burgerchef-best');
            });
            expect(Number(best)).toBeGreaterThanOrEqual(777);
        });

        test('a new game clears the score but keeps the best', async ({ page }) => {
            const d = await page.evaluate(() => {
                startGame();
                score = 500;
                endGame();
                startGame();
                return { score, best };
            });
            expect(d.score).toBe(0);
            expect(d.best).toBeGreaterThanOrEqual(500);
        });
    });

    // -----------------------------------------------------------------------
    // Keyboard integration through the real event handlers
    // -----------------------------------------------------------------------
    test.describe('keyboard', () => {
        test('arrow keys move the chef', async ({ page }) => {
            await page.evaluate(() => { startGame(); setChef(300, 4); });
            await page.keyboard.down('ArrowRight');
            await page.waitForTimeout(150);
            await page.keyboard.up('ArrowRight');
            const x = await page.evaluate(() => chef.x);
            expect(x).toBeGreaterThan(300);
        });

        test('releasing the key stops the chef', async ({ page }) => {
            await page.evaluate(() => { startGame(); setChef(300, 4); });
            await page.keyboard.down('ArrowRight');
            await page.waitForTimeout(100);
            await page.keyboard.up('ArrowRight');
            await page.waitForTimeout(50);
            const first = await page.evaluate(() => chef.x);
            await page.waitForTimeout(150);
            const second = await page.evaluate(() => chef.x);
            expect(second).toBe(first);
        });

        test('Space sprays pepper while playing', async ({ page }) => {
            await page.evaluate(() => { startGame(); setChef(300, 4); });
            const before = await page.evaluate(() => peppers);
            await page.keyboard.press('Space');
            const after = await page.evaluate(() => peppers);
            expect(after).toBe(before - 1);
        });
    });
});
