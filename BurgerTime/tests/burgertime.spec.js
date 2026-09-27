const { test, expect } = require('@playwright/test');
const path = require('path');
const { pathToFileURL } = require('url');

const GAME_URL = pathToFileURL(path.resolve(__dirname, '../index.html')).href;

// Advance the simulation deterministically: `frames` calls to step(dt).
const advance = (page, frames, dt = 1 / 60) =>
    page.evaluate(([f, d]) => {
        for (let i = 0; i < f; i++) step(d);
    }, [frames, dt]);

// Chromium can acknowledge a synthetic key event before the page's listener has
// run, so every key press is confirmed against the game state before the
// simulation is advanced. Without this the specs race the real animation loop.
const KEY_DIR = {
    ArrowLeft: { x: -1, y: 0 },
    ArrowRight: { x: 1, y: 0 },
    ArrowUp: { x: 0, y: -1 },
    ArrowDown: { x: 0, y: 1 },
    a: { x: -1, y: 0 },
    d: { x: 1, y: 0 },
    w: { x: 0, y: -1 },
    s: { x: 0, y: 1 },
};

const hold = async (page, key) => {
    await page.keyboard.down(key);
    await page.waitForFunction(
        (want) => chef.dir.x === want.x && chef.dir.y === want.y,
        KEY_DIR[key]
    );
};

const release = async (page, key) => {
    await page.keyboard.up(key);
    await page.waitForFunction(() => chef.dir.x === 0 && chef.dir.y === 0);
};

// Start a game with monster spawning switched off, so long simulations stay
// deterministic. Specs that are about monsters leave spawning on.
const startQuiet = (page) =>
    page.evaluate(() => {
        startGame();
        spawnEnabled = false;
    });

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

        test('canvas is 560x460', async ({ page }) => {
            const canvas = page.locator('#canvas');
            await expect(canvas).toHaveAttribute('width', '560');
            await expect(canvas).toHaveAttribute('height', '460');
        });

        test('state is idle before starting', async ({ page }) => {
            expect(await page.evaluate(() => state)).toBe('idle');
        });

        test('HUD shows starting score, level, lives and pepper', async ({ page }) => {
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

        test('no monsters before starting', async ({ page }) => {
            expect(await page.evaluate(() => enemies.length)).toBe(0);
        });

        test('there are twelve ingredients across three stacks', async ({ page }) => {
            expect(await page.evaluate(() => ingredients.length)).toBe(12);
            expect(await page.evaluate(() => plates.length)).toBe(3);
        });

        test('each stack has one ingredient per non-plate floor', async ({ page }) => {
            const layout = await page.evaluate(() =>
                [0, 1, 2].map((s) =>
                    ingredients
                        .filter((i) => i.stack === s)
                        .map((i) => i.floor)
                        .sort()
                )
            );
            expect(layout).toEqual([
                [0, 1, 2, 3],
                [0, 1, 2, 3],
                [0, 1, 2, 3],
            ]);
        });

        test('ingredients start untripped and off the plates', async ({ page }) => {
            expect(
                await page.evaluate(() =>
                    ingredients.every((i) => i.steps.every((s) => !s) && !i.onPlate && !i.falling)
                )
            ).toBe(true);
            expect(await page.evaluate(() => ingredientsOnPlates())).toBe(0);
        });

        test('step() does nothing while idle', async ({ page }) => {
            const before = await page.evaluate(() => chef.x);
            await advance(page, 60);
            expect(await page.evaluate(() => chef.x)).toBe(before);
        });
    });

    // -----------------------------------------------------------------------
    // Starting
    // -----------------------------------------------------------------------
    test.describe('starting', () => {
        test('Space starts the game', async ({ page }) => {
            await page.keyboard.press('Space');
            await page.waitForFunction(() => state === 'running');
            expect(await page.evaluate(() => state)).toBe('running');
        });

        test('Enter starts the game', async ({ page }) => {
            await page.keyboard.press('Enter');
            await page.waitForFunction(() => state === 'running');
            expect(await page.evaluate(() => state)).toBe('running');
        });

        test('the start button starts the game', async ({ page }) => {
            await page.locator('#btn-start').click();
            await page.waitForFunction(() => state === 'running');
            expect(await page.evaluate(() => state)).toBe('running');
        });

        test('overlay hides once running', async ({ page }) => {
            await page.keyboard.press('Enter');
            await expect(page.locator('#overlay')).not.toHaveClass(/visible/);
        });

        test('chef starts on a floor between the burger stacks', async ({ page }) => {
            await page.keyboard.press('Enter');
            await page.waitForFunction(() => state === 'running');
            const c = await page.evaluate(() => ({ floor: chef.floor, mode: chef.mode }));
            expect(c.mode).toBe('floor');
            expect(c.floor).toBe(2);
            expect(await page.evaluate(() => stackOfX(chef.x))).toBe(-1);
        });
    });

    // -----------------------------------------------------------------------
    // Chef movement
    // -----------------------------------------------------------------------
    test.describe('movement', () => {
        test.beforeEach(async ({ page }) => {
            await startQuiet(page);
        });

        test('holding right walks the chef right', async ({ page }) => {
            const before = await page.evaluate(() => chef.x);
            await hold(page, 'ArrowRight');
            await advance(page, 30);
            expect(await page.evaluate(() => chef.x)).toBeGreaterThan(before);
        });

        test('holding left walks the chef left', async ({ page }) => {
            const before = await page.evaluate(() => chef.x);
            await hold(page, 'ArrowLeft');
            await advance(page, 30);
            expect(await page.evaluate(() => chef.x)).toBeLessThan(before);
        });

        test('W A S D also drive the chef', async ({ page }) => {
            const before = await page.evaluate(() => chef.x);
            await hold(page, 'd');
            await advance(page, 30);
            expect(await page.evaluate(() => chef.x)).toBeGreaterThan(before);
        });

        test('walking sets the facing direction', async ({ page }) => {
            await hold(page, 'ArrowLeft');
            await advance(page, 10);
            expect(await page.evaluate(() => chef.facing)).toBe(-1);
            await release(page, 'ArrowLeft');
            await hold(page, 'ArrowRight');
            await advance(page, 10);
            expect(await page.evaluate(() => chef.facing)).toBe(1);
        });

        test('chef is clamped to the left wall', async ({ page }) => {
            await hold(page, 'ArrowLeft');
            await advance(page, 240);
            const x = await page.evaluate(() => chef.x);
            expect(x).toBeGreaterThanOrEqual(0);
            expect(x).toBeLessThan(await page.evaluate(() => TILE_W));
        });

        test('chef is clamped to the right wall', async ({ page }) => {
            await hold(page, 'ArrowRight');
            await advance(page, 320);
            const x = await page.evaluate(() => chef.x);
            expect(x).toBeLessThanOrEqual(await page.evaluate(() => CANVAS_W));
            expect(x).toBeGreaterThan(await page.evaluate(() => CANVAS_W - TILE_W));
        });

        test('pressing up on a ladder starts a climb', async ({ page }) => {
            await page.evaluate(() => placeChef(ladderX(0), 2));
            await hold(page, 'ArrowUp');
            await advance(page, 20);
            expect(await page.evaluate(() => chef.mode)).toBe('ladder');
            expect(await page.evaluate(() => chef.y)).toBeLessThan(
                await page.evaluate(() => FLOOR_Y[2])
            );
        });

        test('letting go at the floor above lands the chef there', async ({ page }) => {
            await page.evaluate(() => {
                placeChef(ladderX(0), 2);
                chef.dir.y = -1;
                for (let i = 0; i < 400 && chef.y > FLOOR_Y[1]; i++) step(1 / 60);
                chef.dir.y = 0;
                step(1 / 60);
            });
            expect(await page.evaluate(() => chef.mode)).toBe('floor');
            expect(await page.evaluate(() => chef.floor)).toBe(1);
            expect(await page.evaluate(() => chef.y)).toBe(await page.evaluate(() => FLOOR_Y[1]));
        });

        test('letting go at the floor below lands the chef there', async ({ page }) => {
            await page.evaluate(() => {
                placeChef(ladderX(0), 2);
                chef.dir.y = 1;
                for (let i = 0; i < 400 && chef.y < FLOOR_Y[3]; i++) step(1 / 60);
                chef.dir.y = 0;
                step(1 / 60);
            });
            expect(await page.evaluate(() => chef.mode)).toBe('floor');
            expect(await page.evaluate(() => chef.floor)).toBe(3);
        });

        test('holding up climbs to the top of the ladder and stops', async ({ page }) => {
            await page.evaluate(() => placeChef(ladderX(0), 2));
            await hold(page, 'ArrowUp');
            await advance(page, 240);
            expect(await page.evaluate(() => chef.floor)).toBe(0);
            expect(await page.evaluate(() => chef.mode)).toBe('floor');
            expect(await page.evaluate(() => chef.y)).toBe(await page.evaluate(() => FLOOR_Y[0]));
        });

        test('holding down climbs to the bottom of the ladder and stops', async ({ page }) => {
            await page.evaluate(() => placeChef(ladderX(0), 2));
            await hold(page, 'ArrowDown');
            await advance(page, 240);
            expect(await page.evaluate(() => chef.floor)).toBe(4);
            expect(await page.evaluate(() => chef.mode)).toBe('floor');
        });

        test('chef cannot climb where there is no ladder', async ({ page }) => {
            await page.evaluate(() => placeChef(STACK_LEFT[0] + 2 * TILE_W, 2));
            await hold(page, 'ArrowUp');
            await advance(page, 60);
            expect(await page.evaluate(() => chef.mode)).toBe('floor');
            expect(await page.evaluate(() => chef.floor)).toBe(2);
        });

        test('chef cannot climb above the top floor', async ({ page }) => {
            await page.evaluate(() => placeChef(ladderX(0), 0));
            await hold(page, 'ArrowUp');
            await advance(page, 60);
            expect(await page.evaluate(() => chef.y)).toBe(await page.evaluate(() => FLOOR_Y[0]));
        });

        test('chef cannot climb below the plate floor', async ({ page }) => {
            await page.evaluate(() => placeChef(ladderX(0), 4));
            await hold(page, 'ArrowDown');
            await advance(page, 60);
            expect(await page.evaluate(() => chef.y)).toBe(await page.evaluate(() => FLOOR_Y[4]));
        });

        test('a half-height ladder does not continue past its span', async ({ page }) => {
            // The ladder in column 6 spans floors 0-2 only, so from floor 2 it
            // cannot be used to go further down.
            await page.evaluate(() => placeChef(ladderX(6), 2));
            await hold(page, 'ArrowDown');
            await advance(page, 60);
            expect(await page.evaluate(() => chef.floor)).toBe(2);
            expect(await page.evaluate(() => chef.mode)).toBe('floor');
        });
    });

    // -----------------------------------------------------------------------
    // Tripping and dropping ingredients
    // -----------------------------------------------------------------------
    test.describe('ingredients', () => {
        test.beforeEach(async ({ page }) => {
            await startQuiet(page);
        });

        test('standing on an ingredient tile presses that step down', async ({ page }) => {
            await page.evaluate(() => placeChef(STACK_LEFT[0] + TILE_W / 2, 3));
            await advance(page, 2);
            const steps = await page.evaluate(
                () => ingredients.find((i) => i.stack === 0 && i.floor === 3).steps
            );
            expect(steps[0]).toBe(true);
            expect(steps[3]).toBe(false);
        });

        test('walking the full width trips every step', async ({ page }) => {
            await page.evaluate(() => {
                placeChef(STACK_LEFT[0], 3);
                chef.dir.x = 1;
            });
            await advance(page, 44);
            const ing = await page.evaluate(() =>
                ingredients.find((i) => i.stack === 0 && i.kind === 'bunbottom')
            );
            expect(ing.falling || ing.onPlate).toBe(true);
        });

        test('dropping an ingredient scores points', async ({ page }) => {
            await page.evaluate(() => {
                placeChef(STACK_LEFT[0], 3);
                chef.dir.x = 1;
            });
            await advance(page, 120);
            expect(await page.evaluate(() => score)).toBeGreaterThan(0);
        });

        test('the bottom ingredient lands on the plate', async ({ page }) => {
            await page.evaluate(() => {
                placeChef(STACK_LEFT[0], 3);
                chef.dir.x = 1;
            });
            await advance(page, 200);
            expect(await page.evaluate(() => plates[0].count)).toBe(1);
            expect(await page.evaluate(() => ingredientsOnPlates())).toBe(1);
        });

        test('an ingredient landing on a resting one knocks it loose too', async ({ page }) => {
            // Trip the floor-2 patty; it falls onto the floor-3 bottom bun, which
            // is knocked loose in turn and carries on to the plate.
            await page.evaluate(() => {
                placeChef(STACK_LEFT[1], 2);
                chef.dir.x = 1;
            });
            await advance(page, 260);
            const plated = await page.evaluate(() =>
                ingredients
                    .filter((i) => i.stack === 1 && i.onPlate)
                    .map((i) => i.kind)
                    .sort()
            );
            expect(plated).toEqual(['bunbottom', 'patty']);
            expect(await page.evaluate(() => plates[1].count)).toBe(2);
        });

        test('a chained drop resets the knocked-loose ingredient steps', async ({ page }) => {
            await page.evaluate(() => {
                placeChef(STACK_LEFT[1], 2);
                chef.dir.x = 1;
            });
            await advance(page, 260);
            expect(
                await page.evaluate(() =>
                    ingredients
                        .filter((i) => i.stack === 1 && !i.onPlate)
                        .every((i) => i.steps.every((s) => !s))
                )
            ).toBe(true);
        });

        test('a chain is worth more than the same drops taken singly', async ({ page }) => {
            const single = await page.evaluate(() => {
                startGame();
                spawnEnabled = false;
                placeChef(STACK_LEFT[0], 3);
                chef.dir.x = 1;
                for (let i = 0; i < 200; i++) step(1 / 60);
                return score;
            });
            await page.reload();
            const chained = await page.evaluate(() => {
                startGame();
                spawnEnabled = false;
                placeChef(STACK_LEFT[1], 2);
                chef.dir.x = 1;
                for (let i = 0; i < 260; i++) step(1 / 60);
                return score;
            });
            expect(single).toBeGreaterThan(0);
            expect(chained).toBeGreaterThan(single * 2);
        });

        test('the chef rides the ingredient down to the plate floor', async ({ page }) => {
            const rode = await page.evaluate(() => {
                placeChef(STACK_LEFT[0], 3);
                chef.dir.x = 1;
                let seen = false;
                for (let i = 0; i < 300; i++) {
                    step(1 / 60);
                    if (chef.mode === 'riding') seen = true;
                }
                return seen;
            });
            expect(rode).toBe(true);
            expect(await page.evaluate(() => chef.mode)).toBe('floor');
            expect(await page.evaluate(() => chef.floor)).toBe(4);
        });

        test('a plated ingredient is no longer tripable', async ({ page }) => {
            await page.evaluate(() => {
                placeChef(STACK_LEFT[0], 3);
                chef.dir.x = 1;
            });
            await advance(page, 260);
            await page.evaluate(() => {
                chef.dir.x = -1;
            });
            await advance(page, 120);
            expect(await page.evaluate(() => plates[0].count)).toBe(1);
        });
    });

    // -----------------------------------------------------------------------
    // Monsters
    // -----------------------------------------------------------------------
    test.describe('monsters', () => {
        test('monsters appear over time', async ({ page }) => {
            // The chef may be caught and respawn (which clears the board) during a
            // ten second simulation, so this checks the peak population.
            const peak = await page.evaluate(() => {
                startGame();
                let most = 0;
                for (let i = 0; i < 600; i++) {
                    step(1 / 60);
                    most = Math.max(most, enemies.length);
                }
                return most;
            });
            expect(peak).toBeGreaterThan(0);
        });

        test('a monster walks toward the chef', async ({ page }) => {
            await startQuiet(page);
            const gap = await page.evaluate(() => {
                placeChef(CANVAS_W - TILE_W, 2);
                spawnEnemy('hotdog', TILE_W / 2, 2);
                return Math.abs(enemies[0].x - chef.x);
            });
            await advance(page, 120);
            const after = await page.evaluate(() => Math.abs(enemies[0].x - chef.x));
            expect(after).toBeLessThan(gap);
        });

        test('a monster on another floor heads for a ladder', async ({ page }) => {
            await startQuiet(page);
            await page.evaluate(() => {
                placeChef(ladderX(0), 0);
                spawnEnemy('egg', ladderX(0) + 3 * TILE_W, 2);
            });
            await advance(page, 240);
            expect(await page.evaluate(() => enemies[0].floor)).toBeLessThan(2);
        });

        test('touching a monster costs a life', async ({ page }) => {
            await startQuiet(page);
            await page.evaluate(() => {
                placeChef(CANVAS_W / 2, 2);
                spawnEnemy('pickle', CANVAS_W / 2, 2);
            });
            await advance(page, 3);
            expect(await page.evaluate(() => lives)).toBe(2);
            expect(await page.evaluate(() => state)).toBe('dying');
        });

        test('the chef respawns after dying', async ({ page }) => {
            await startQuiet(page);
            await page.evaluate(() => {
                placeChef(CANVAS_W / 2, 2);
                spawnEnemy('pickle', CANVAS_W / 2, 2);
            });
            await advance(page, 200);
            expect(await page.evaluate(() => state)).toBe('running');
            expect(await page.evaluate(() => enemies.length)).toBe(0);
            expect(await page.evaluate(() => chef.floor)).toBe(2);
        });

        test('ingredient progress survives a death', async ({ page }) => {
            await startQuiet(page);
            await page.evaluate(() => {
                placeChef(STACK_LEFT[0], 3);
                chef.dir.x = 1;
            });
            await advance(page, 260);
            await page.evaluate(() => spawnEnemy('egg', chef.x, chef.floor));
            await advance(page, 220);
            expect(await page.evaluate(() => ingredientsOnPlates())).toBe(1);
        });

        test('running out of lives ends the game', async ({ page }) => {
            await startQuiet(page);
            await page.evaluate(() => {
                lives = 1;
                placeChef(CANVAS_W / 2, 2);
                spawnEnemy('pickle', CANVAS_W / 2, 2);
            });
            await advance(page, 3);
            expect(await page.evaluate(() => lives)).toBe(0);
            await advance(page, 200);
            expect(await page.evaluate(() => state)).toBe('over');
            await expect(page.locator('#overlay')).toHaveClass(/visible/);
        });

        test('a falling ingredient squashes a monster', async ({ page }) => {
            await startQuiet(page);
            await page.evaluate(() => {
                spawnEnemy('hotdog', STACK_LEFT[0] + 2 * TILE_W, 4).frozen = true;
                placeChef(STACK_LEFT[0], 3);
                chef.dir.x = 1;
            });
            await advance(page, 260);
            expect(
                await page.evaluate(() => enemies.filter((e) => e.state === 'active').length)
            ).toBe(0);
            expect(await page.evaluate(() => score)).toBeGreaterThanOrEqual(500);
        });

        test('a squashed monster cannot hurt the chef', async ({ page }) => {
            await startQuiet(page);
            await page.evaluate(() => {
                spawnEnemy('hotdog', STACK_LEFT[0] + 2 * TILE_W, 4).frozen = true;
                placeChef(STACK_LEFT[0], 3);
                chef.dir.x = 1;
            });
            await advance(page, 260);
            expect(await page.evaluate(() => lives)).toBe(3);
            expect(await page.evaluate(() => state)).toBe('running');
        });

        test('the chef is safe from monsters while riding', async ({ page }) => {
            await startQuiet(page);
            const safe = await page.evaluate(() => {
                placeChef(STACK_LEFT[0], 3);
                chef.dir.x = 1;
                let ok = true;
                for (let i = 0; i < 300; i++) {
                    if (chef.mode === 'riding') {
                        enemies.length = 0;
                        spawnEnemy('pickle', chef.x, 3).frozen = true;
                        enemies[0].y = chef.y;
                    }
                    step(1 / 60);
                    if (state === 'dying') ok = false;
                }
                return ok;
            });
            expect(safe).toBe(true);
        });
    });

    // -----------------------------------------------------------------------
    // Pepper
    // -----------------------------------------------------------------------
    test.describe('pepper', () => {
        test.beforeEach(async ({ page }) => {
            await startQuiet(page);
        });

        test('Space sprays pepper and uses a shake', async ({ page }) => {
            await page.keyboard.press('Space');
            await page.waitForFunction(() => peppers === 4);
            expect(await page.evaluate(() => peppers)).toBe(4);
            await expect(page.locator('#pepper')).toHaveText('4');
        });

        test('spraying makes a cloud', async ({ page }) => {
            await page.evaluate(() => spray());
            expect(await page.evaluate(() => clouds.length)).toBe(1);
        });

        test('the cloud fades away', async ({ page }) => {
            await page.evaluate(() => spray());
            await advance(page, 60);
            expect(await page.evaluate(() => clouds.length)).toBe(0);
        });

        test('spraying stuns a monster in front of the chef', async ({ page }) => {
            await page.evaluate(() => {
                placeChef(CANVAS_W / 2, 2);
                chef.facing = 1;
                spawnEnemy('egg', CANVAS_W / 2 + TILE_W, 2);
                spray();
            });
            expect(await page.evaluate(() => enemies[0].state)).toBe('stunned');
        });

        test('spraying does not reach behind the chef', async ({ page }) => {
            await page.evaluate(() => {
                placeChef(CANVAS_W / 2, 2);
                chef.facing = 1;
                spawnEnemy('egg', CANVAS_W / 2 - 3 * TILE_W, 2);
                spray();
            });
            expect(await page.evaluate(() => enemies[0].state)).toBe('active');
        });

        test('a stunned monster does not move', async ({ page }) => {
            const before = await page.evaluate(() => {
                placeChef(CANVAS_W / 2, 2);
                chef.facing = 1;
                spawnEnemy('egg', CANVAS_W / 2 + TILE_W, 2);
                spray();
                return enemies[0].x;
            });
            await advance(page, 60);
            expect(await page.evaluate(() => enemies[0].x)).toBeCloseTo(before, 5);
        });

        test('a stunned monster does not cost a life', async ({ page }) => {
            await page.evaluate(() => {
                placeChef(CANVAS_W / 2, 2);
                chef.facing = 1;
                spawnEnemy('egg', CANVAS_W / 2 + TILE_W, 2);
                spray();
                chef.x = enemies[0].x;
            });
            await advance(page, 30);
            expect(await page.evaluate(() => lives)).toBe(3);
            expect(await page.evaluate(() => state)).toBe('running');
        });

        test('a stun wears off', async ({ page }) => {
            // Stops the moment the stun lifts: once active again the monster walks
            // into the chef, which would clear the board.
            const result = await page.evaluate(() => {
                placeChef(CANVAS_W / 2, 2);
                chef.facing = 1;
                const e = spawnEnemy('egg', CANVAS_W / 2 + TILE_W, 2);
                spray();
                const stunned = e.state;
                let elapsed = 0;
                while (elapsed < 8 && e.state === 'stunned') {
                    step(1 / 60);
                    elapsed += 1 / 60;
                }
                return { stunned, after: e.state, elapsed };
            });
            expect(result.stunned).toBe('stunned');
            expect(result.after).toBe('active');
            expect(result.elapsed).toBeGreaterThan(3.5);
        });

        test('the chef cannot spray with an empty shaker', async ({ page }) => {
            await page.evaluate(() => {
                peppers = 0;
                spray();
            });
            expect(await page.evaluate(() => peppers)).toBe(0);
            expect(await page.evaluate(() => clouds.length)).toBe(0);
        });

        test('pepper cannot be sprayed while riding', async ({ page }) => {
            const result = await page.evaluate(() => {
                placeChef(STACK_LEFT[0], 3);
                chef.dir.x = 1;
                for (let i = 0; i < 300 && chef.mode !== 'riding'; i++) step(1 / 60);
                const before = peppers;
                spray();
                return { riding: chef.mode === 'riding', before, after: peppers };
            });
            expect(result.riding).toBe(true);
            expect(result.after).toBe(result.before);
        });
    });

    // -----------------------------------------------------------------------
    // Level flow
    // -----------------------------------------------------------------------
    test.describe('levels', () => {
        test.beforeEach(async ({ page }) => {
            await startQuiet(page);
        });

        test('plating every ingredient clears the level', async ({ page }) => {
            await page.evaluate(() => plateEverythingForTest());
            await advance(page, 2);
            expect(await page.evaluate(() => state)).toBe('levelclear');
        });

        test('the next level resets the ingredients and pepper', async ({ page }) => {
            await page.evaluate(() => {
                peppers = 1;
                plateEverythingForTest();
            });
            await advance(page, 202);
            expect(await page.evaluate(() => state)).toBe('running');
            expect(await page.evaluate(() => level)).toBe(2);
            expect(await page.evaluate(() => ingredientsOnPlates())).toBe(0);
            expect(await page.evaluate(() => peppers)).toBe(5);
        });

        test('score carries into the next level', async ({ page }) => {
            await page.evaluate(() => {
                score = 1234;
                plateEverythingForTest();
            });
            await advance(page, 202);
            expect(await page.evaluate(() => score)).toBe(1234);
        });

        test('monsters get faster each level', async ({ page }) => {
            const l1 = await page.evaluate(() => enemySpeed());
            await page.evaluate(() => {
                level = 4;
            });
            expect(await page.evaluate(() => enemySpeed())).toBeGreaterThan(l1);
        });

        test('monsters never outrun the chef', async ({ page }) => {
            await page.evaluate(() => {
                level = 40;
            });
            expect(await page.evaluate(() => enemySpeed())).toBeLessThan(
                await page.evaluate(() => CHEF_SPEED)
            );
        });

        test('monsters arrive more often at higher levels', async ({ page }) => {
            const l1 = await page.evaluate(() => spawnInterval());
            await page.evaluate(() => {
                level = 5;
            });
            expect(await page.evaluate(() => spawnInterval())).toBeLessThan(l1);
        });
    });

    // -----------------------------------------------------------------------
    // Pause
    // -----------------------------------------------------------------------
    test.describe('pause', () => {
        test.beforeEach(async ({ page }) => {
            await startQuiet(page);
        });

        test('P pauses the game', async ({ page }) => {
            await page.keyboard.press('p');
            await page.waitForFunction(() => state === 'paused');
            expect(await page.evaluate(() => state)).toBe('paused');
            await expect(page.locator('#overlay')).toHaveClass(/visible/);
        });

        test('P resumes the game', async ({ page }) => {
            await page.keyboard.press('p');
            await page.waitForFunction(() => state === 'paused');
            await page.keyboard.press('p');
            await page.waitForFunction(() => state === 'running');
            expect(await page.evaluate(() => state)).toBe('running');
        });

        test('nothing moves while paused', async ({ page }) => {
            await page.evaluate(() => {
                chef.dir.x = 1;
                togglePause();
            });
            const before = await page.evaluate(() => chef.x);
            await advance(page, 60);
            expect(await page.evaluate(() => chef.x)).toBe(before);
        });
    });

    // -----------------------------------------------------------------------
    // Scoring persistence
    // -----------------------------------------------------------------------
    test.describe('best score', () => {
        test('a new best is stored on game over', async ({ page }) => {
            await startQuiet(page);
            await page.evaluate(() => {
                score = 7777;
                lives = 1;
                placeChef(CANVAS_W / 2, 2);
                spawnEnemy('pickle', CANVAS_W / 2, 2);
            });
            await advance(page, 220);
            expect(await page.evaluate(() => state)).toBe('over');
            await expect(page.locator('#best')).toHaveText('7777');
            expect(await page.evaluate(() => window.localStorage.getItem('burgertime-best'))).toBe(
                '7777'
            );
        });

        test('a lower score does not replace the best', async ({ page }) => {
            await page.evaluate(() => window.localStorage.setItem('burgertime-best', '9999'));
            await page.reload();
            await startQuiet(page);
            await page.evaluate(() => {
                score = 10;
                lives = 1;
                placeChef(CANVAS_W / 2, 2);
                spawnEnemy('pickle', CANVAS_W / 2, 2);
            });
            await advance(page, 220);
            await expect(page.locator('#best')).toHaveText('9999');
        });

        test('restarting after game over resets the run', async ({ page }) => {
            await startQuiet(page);
            await page.evaluate(() => {
                score = 500;
                lives = 1;
                level = 3;
                placeChef(CANVAS_W / 2, 2);
                spawnEnemy('pickle', CANVAS_W / 2, 2);
            });
            await advance(page, 220);
            await page.keyboard.press('Enter');
            await page.waitForFunction(() => state === 'running');
            expect(await page.evaluate(() => score)).toBe(0);
            expect(await page.evaluate(() => lives)).toBe(3);
            expect(await page.evaluate(() => level)).toBe(1);
        });
    });

    // -----------------------------------------------------------------------
    // Rendering
    // -----------------------------------------------------------------------
    test.describe('rendering', () => {
        test('the canvas is painted', async ({ page }) => {
            await startQuiet(page);
            await advance(page, 30);
            const painted = await page.evaluate(() => {
                draw();
                const d = ctx.getImageData(0, 0, CANVAS_W, CANVAS_H).data;
                for (let i = 0; i < d.length; i += 4) {
                    if (d[i] > 20 || d[i + 1] > 20 || d[i + 2] > 20) return true;
                }
                return false;
            });
            expect(painted).toBe(true);
        });

        test('drawing works in every state without throwing', async ({ page }) => {
            const errors = [];
            page.on('pageerror', (e) => errors.push(e.message));
            await page.evaluate(() => {
                draw(); // idle
                startGame();
                spawnEnabled = false;
                spawnEnemy('sausage', TILE_W / 2, 4);
                spawnEnemy('hotdog', ladderX(0), 0);
                spray();
                for (let i = 0; i < 120; i++) step(1 / 60);
                draw();
                togglePause();
                draw(); // paused
                togglePause();
                lives = 1;
                placeChef(CANVAS_W / 2, 2);
                spawnEnemy('pickle', CANVAS_W / 2, 2);
                step(1 / 60);
                draw(); // dying
                for (let i = 0; i < 200; i++) step(1 / 60);
                draw(); // over
                startGame();
                spawnEnabled = false;
                plateEverythingForTest();
                step(1 / 60);
                draw(); // level clear
                for (let i = 0; i < 200; i++) step(1 / 60);
                draw();
            });
            expect(errors).toEqual([]);
        });
    });
});
