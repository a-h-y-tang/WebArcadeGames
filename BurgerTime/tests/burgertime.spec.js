const { test, expect } = require('@playwright/test');
const path = require('path');
const { pathToFileURL } = require('url');

const GAME_URL = pathToFileURL(path.resolve(__dirname, '../index.html')).href;

// Drive the simulation deterministically: `step()` takes a fixed dt, so the
// tests never depend on requestAnimationFrame wall-clock timing.
const RUN = `(function run(seconds, dt) {
    dt = dt || 1 / 60;
    for (let t = 0; t < seconds; t += dt) step(dt);
})`;

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

        test('HUD starts at score 0, level 1, 3 lives, 5 peppers', async ({ page }) => {
            await expect(page.locator('#score')).toHaveText('0');
            await expect(page.locator('#level')).toHaveText('1');
            await expect(page.locator('#lives')).toHaveText('3');
            await expect(page.locator('#peppers')).toHaveText('5');
            await expect(page.locator('#best')).toHaveText('0');
        });

        test('canvas is 512x512', async ({ page }) => {
            const canvas = page.locator('#canvas');
            await expect(canvas).toHaveAttribute('width', '512');
            await expect(canvas).toHaveAttribute('height', '512');
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
    // World geometry
    // -----------------------------------------------------------------------
    test.describe('geometry', () => {
        test('five girders at the expected rows', async ({ page }) => {
            expect(await page.evaluate(() => FLOOR_ROWS)).toEqual([2, 5, 8, 11, 14]);
            expect(await page.evaluate(() => PLATE_ROW)).toBe(14);
        });

        test('rowY converts a grid row to pixels', async ({ page }) => {
            const ys = await page.evaluate(() => [TILE, rowY(0), rowY(2), rowY(14)]);
            expect(ys).toEqual([32, 0, 64, 448]);
        });

        test('three burger lanes, four tiles wide, inside the canvas', async ({ page }) => {
            const lanes = await page.evaluate(() => ({
                count: LANES.length,
                width: INGREDIENT_COLS * TILE,
                xs: LANES.map((_, i) => laneX(i)),
                right: laneX(LANES.length - 1) + INGREDIENT_COLS * TILE,
                w: CANVAS_W,
            }));
            expect(lanes.count).toBe(3);
            expect(lanes.width).toBe(128);
            expect(lanes.xs).toEqual([32, 192, 352]);
            expect(lanes.right).toBeLessThanOrEqual(lanes.w);
        });

        test('ladders sit in the gaps between lanes', async ({ page }) => {
            const overlaps = await page.evaluate(() => LADDERS.filter((l) =>
                LANES.some((start) => l.col >= start && l.col < start + INGREDIENT_COLS)).length);
            expect(overlaps).toBe(0);
        });

        test('every girder is reachable from the full-height ladder', async ({ page }) => {
            const covered = await page.evaluate(() => FLOOR_ROWS.every((r) =>
                LADDERS.some((l) => l.top <= r && l.bottom >= r)));
            expect(covered).toBe(true);
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

        test('a fresh game resets score, level, lives and pepper', async ({ page }) => {
            const s = await page.evaluate(() => {
                score = 999; level = 4; lives = 1; peppers = 0;
                startGame();
                return { score, level, lives, peppers };
            });
            expect(s).toEqual({ score: 0, level: 1, lives: 3, peppers: 5 });
        });

        test('twelve ingredients, none plated, none pressed', async ({ page }) => {
            const s = await page.evaluate(() => {
                startGame();
                return {
                    count: ingredients.length,
                    plated: ingredients.filter((i) => i.onPlate).length,
                    pressed: ingredients.filter((i) => i.sections.some(Boolean)).length,
                    sections: ingredients[0].sections.length,
                };
            });
            expect(s).toEqual({ count: 12, plated: 0, pressed: 0, sections: 4 });
        });

        test('each lane holds one of each ingredient type', async ({ page }) => {
            const types = await page.evaluate(() => {
                startGame();
                return LANES.map((_, lane) => ingredients.filter((i) => i.lane === lane)
                    .map((i) => i.type).sort());
            });
            expect(types[0]).toEqual(types[1]);
            expect(types[1]).toEqual(types[2]);
            expect(types[0].length).toBe(4);
        });

        test('the chef starts standing on a girder', async ({ page }) => {
            const ok = await page.evaluate(() => {
                startGame();
                return FLOOR_ROWS.some((r) => Math.abs(rowY(r) - player.y) < 0.001)
                    && player.x > 0 && player.x < CANVAS_W;
            });
            expect(ok).toBe(true);
        });

        test('level 1 spawns two enemies on girders', async ({ page }) => {
            const s = await page.evaluate(() => {
                startGame();
                return {
                    count: enemies.length,
                    onFloors: enemies.every((e) => FLOOR_ROWS.some((r) => Math.abs(rowY(r) - e.y) < 0.001)),
                };
            });
            expect(s.count).toBe(2);
            expect(s.onFloors).toBe(true);
        });
    });

    // -----------------------------------------------------------------------
    // Movement
    // -----------------------------------------------------------------------
    test.describe('movement', () => {
        test('holding right walks the chef right along the girder', async ({ page }) => {
            const s = await page.evaluate(([run]) => {
                startGame();
                enemies.length = 0;
                player.x = 160; player.y = rowY(14);
                keys.right = true;
                eval(run)(0.5);
                return { x: player.x, y: player.y };
            }, [RUN]);
            expect(s.x).toBeGreaterThan(160);
            expect(s.y).toBe(448);
        });

        test('holding left walks the chef left', async ({ page }) => {
            const x = await page.evaluate(([run]) => {
                startGame();
                enemies.length = 0;
                player.x = 300; player.y = rowY(14);
                keys.left = true;
                eval(run)(0.5);
                return player.x;
            }, [RUN]);
            expect(x).toBeLessThan(300);
        });

        test('the chef cannot walk off the edge of the canvas', async ({ page }) => {
            const s = await page.evaluate(([run]) => {
                startGame();
                enemies.length = 0;
                player.x = 20; player.y = rowY(14);
                keys.left = true;
                eval(run)(4);
                const left = player.x;
                keys.left = false; keys.right = true;
                eval(run)(12);
                return { left, right: player.x };
            }, [RUN]);
            expect(s.left).toBeGreaterThanOrEqual(0);
            expect(s.right).toBeLessThanOrEqual(512);
        });

        test('climbing needs a ladder — pressing up mid-girder does nothing', async ({ page }) => {
            const s = await page.evaluate(([run]) => {
                startGame();
                enemies.length = 0;
                player.x = laneX(0) + 64; player.y = rowY(11);
                keys.up = true;
                eval(run)(0.5);
                return { y: player.y, expected: rowY(11) };
            }, [RUN]);
            expect(s.y).toBe(s.expected);
        });

        test('pressing up on a ladder climbs to the girder above', async ({ page }) => {
            const s = await page.evaluate(([run]) => {
                startGame();
                enemies.length = 0;
                const ladder = LADDERS.find((l) => l.col === 0);
                player.x = ladderX(ladder); player.y = rowY(11);
                keys.up = true;
                eval(run)(2);
                return { y: player.y, target: rowY(8), start: rowY(11) };
            }, [RUN]);
            expect(s.y).toBeLessThanOrEqual(s.target + 1);
            expect(s.y).toBeLessThan(s.start);
        });

        test('a ladder cannot be climbed above its top', async ({ page }) => {
            const y = await page.evaluate(([run]) => {
                startGame();
                enemies.length = 0;
                const ladder = LADDERS.find((l) => l.col === 0);
                player.x = ladderX(ladder); player.y = rowY(5);
                keys.up = true;
                eval(run)(10);
                return player.y;
            }, [RUN]);
            expect(y).toBe(64); // rowY(2), the top girder
        });

        test('a partial ladder stops at its bottom girder', async ({ page }) => {
            const s = await page.evaluate(([run]) => {
                startGame();
                enemies.length = 0;
                const ladder = LADDERS.find((l) => l.bottom < PLATE_ROW);
                player.x = ladderX(ladder); player.y = rowY(ladder.bottom);
                keys.down = true;
                eval(run)(3);
                return { y: player.y, bottom: rowY(ladder.bottom) };
            }, [RUN]);
            expect(s.y).toBe(s.bottom);
        });
    });

    // -----------------------------------------------------------------------
    // Pressing and dropping ingredients
    // -----------------------------------------------------------------------
    test.describe('ingredients', () => {
        test('walking over a section presses it', async ({ page }) => {
            const sections = await page.evaluate(([run]) => {
                startGame();
                enemies.length = 0;
                const ing = ingredientAt(0, 2);
                player.x = ing.x + 4; player.y = rowY(2);
                keys.right = true;
                eval(run)(0.35);
                return ing.sections.slice();
            }, [RUN]);
            expect(sections[0]).toBe(true);
            expect(sections[3]).toBe(false);
        });

        test('a partly pressed ingredient does not fall', async ({ page }) => {
            const s = await page.evaluate(([run]) => {
                startGame();
                enemies.length = 0;
                const ing = ingredientAt(0, 2);
                player.x = ing.x + 4; player.y = rowY(2);
                keys.right = true;
                eval(run)(0.35);
                return { falling: ing.falling, row: ing.row };
            }, [RUN]);
            expect(s.falling).toBe(false);
            expect(s.row).toBe(2);
        });

        test('walking the whole ingredient drops it and clears the sections', async ({ page }) => {
            const s = await page.evaluate(([run]) => {
                startGame();
                enemies.length = 0;
                const ing = ingredientAt(0, 11);
                player.x = ing.x - 8; player.y = rowY(11);
                keys.right = true;
                eval(run)(3);
                return { falling: ing.falling || ing.onPlate, pressed: ing.sections.filter(Boolean).length };
            }, [RUN]);
            expect(s.falling).toBe(true);
            expect(s.pressed).toBe(0);
        });

        test('climbing past an ingredient row does not press it', async ({ page }) => {
            const pressed = await page.evaluate(([run]) => {
                startGame();
                enemies.length = 0;
                const ladder = LADDERS.find((l) => l.col === 0);
                player.x = ladderX(ladder); player.y = rowY(14);
                keys.up = true;
                eval(run)(6);
                return ingredients.filter((i) => i.sections.some(Boolean)).length;
            }, [RUN]);
            expect(pressed).toBe(0);
        });

        test('a dropped ingredient lands on the next girder down', async ({ page }) => {
            const s = await page.evaluate(([run]) => {
                startGame();
                enemies.length = 0;
                const bottom = ingredientAt(0, 11);
                startFall(bottom);
                eval(run)(4);              // bottom bun reaches the plate
                const patty = ingredientAt(0, 8);
                startFall(patty);
                eval(run)(4);              // patty lands on the now-empty girder 11
                return { row: patty.row, falling: patty.falling, onPlate: patty.onPlate };
            }, [RUN]);
            expect(s).toEqual({ row: 11, falling: false, onPlate: false });
        });

        test('landing scores 50 points', async ({ page }) => {
            const s = await page.evaluate(([run]) => {
                startGame();
                enemies.length = 0;
                startFall(ingredientAt(0, 11));
                eval(run)(4);
                return score;
            }, [RUN]);
            expect(s).toBe(50);
        });

        test('an ingredient landing on another knocks it loose', async ({ page }) => {
            const s = await page.evaluate(([run]) => {
                startGame();
                enemies.length = 0;
                const top = ingredientAt(0, 2);
                const lettuce = ingredientAt(0, 5);
                startFall(top);
                let knocked = false;
                for (let t = 0; t < 3; t += 1 / 60) {
                    step(1 / 60);
                    if (lettuce.falling || lettuce.row > 5) knocked = true;
                }
                return { knocked, plated: ingredients.filter((i) => i.lane === 0 && i.onPlate).length };
            }, [RUN]);
            expect(s.knocked).toBe(true);
            expect(s.plated).toBeGreaterThanOrEqual(2);
        });

        test('ingredients stack on the plate', async ({ page }) => {
            const s = await page.evaluate(([run]) => {
                startGame();
                enemies.length = 0;
                const bottom = ingredientAt(0, 11);
                startFall(bottom);
                eval(run)(4);
                const patty = ingredientAt(0, 8);
                startFall(patty);
                eval(run)(4);
                startFall(patty);
                eval(run)(4);
                return { bunY: bottom.y, pattyY: patty.y, plated: [bottom.onPlate, patty.onPlate] };
            }, [RUN]);
            expect(s.plated).toEqual([true, true]);
            expect(s.pattyY).toBeLessThan(s.bunY);
        });

        test('a falling ingredient squashes an enemy for 500 points', async ({ page }) => {
            const s = await page.evaluate(([run]) => {
                startGame();
                enemies.length = 0;
                spawnEnemy(laneX(0) + 64, rowY(5));
                const enemy = enemies[0];
                enemy.stun = 99;               // hold it still under the drop
                const top = ingredientAt(0, 2);
                startFall(top);
                eval(run)(2);
                return { squashed: enemy.squashed, score };
            }, [RUN]);
            expect(s.squashed).toBe(true);
            expect(s.score).toBeGreaterThanOrEqual(500);
        });

        test('a squashed enemy comes back', async ({ page }) => {
            const s = await page.evaluate(([run]) => {
                startGame();
                enemies.length = 0;
                spawnEnemy(laneX(0) + 64, rowY(5));
                const enemy = enemies[0];
                enemy.squashed = true;
                enemy.respawn = RESPAWN_TIME;
                player.x = 8; player.y = rowY(2);
                eval(run)(RESPAWN_TIME + 1);
                return {
                    squashed: enemy.squashed,
                    inBounds: enemy.x > 0 && enemy.x < CANVAS_W && enemy.y > 0 && enemy.y <= rowY(PLATE_ROW),
                };
            }, [RUN]);
            expect(s.squashed).toBe(false);
            expect(s.inBounds).toBe(true);
        });
    });

    // -----------------------------------------------------------------------
    // Enemies
    // -----------------------------------------------------------------------
    test.describe('enemies', () => {
        test('an enemy walks toward the chef', async ({ page }) => {
            const s = await page.evaluate(([run]) => {
                startGame();
                seedRng(7);
                enemies.length = 0;
                spawnEnemy(80, rowY(14));
                player.x = 400; player.y = rowY(14);
                const before = enemies[0].x;
                eval(run)(1.5);
                return { before, after: enemies[0].x };
            }, [RUN]);
            expect(s.after).toBeGreaterThan(s.before);
        });

        test('an enemy climbs toward a chef on another girder', async ({ page }) => {
            const s = await page.evaluate(([run]) => {
                startGame();
                seedRng(3);
                enemies.length = 0;
                const ladder = LADDERS.find((l) => l.col === 0);
                spawnEnemy(ladderX(ladder), rowY(14));
                player.x = ladderX(ladder); player.y = rowY(8);
                const before = enemies[0].y;
                eval(run)(3);
                return { before, after: enemies[0].y };
            }, [RUN]);
            expect(s.after).toBeLessThan(s.before);
        });

        test('touching an enemy costs a life', async ({ page }) => {
            const s = await page.evaluate(([run]) => {
                startGame();
                enemies.length = 0;
                player.x = 200; player.y = rowY(14);
                spawnEnemy(200, rowY(14));
                eval(run)(0.1);
                return { state, lives };
            }, [RUN]);
            expect(s.state).toBe('dying');
            expect(s.lives).toBe(2);
        });

        test('play resumes after the death pause', async ({ page }) => {
            const s = await page.evaluate(([run]) => {
                startGame();
                enemies.length = 0;
                player.x = 200; player.y = rowY(14);
                spawnEnemy(200, rowY(14));
                eval(run)(0.1);
                eval(run)(DYING_TIME + 0.5);
                return { state, lives, enemyClear: Math.abs(enemies[0].x - player.x) > 1 };
            }, [RUN]);
            expect(s.state).toBe('running');
            expect(s.lives).toBe(2);
            expect(s.enemyClear).toBe(true);
        });

        test('losing the last life ends the game', async ({ page }) => {
            const s = await page.evaluate(([run]) => {
                startGame();
                enemies.length = 0;
                lives = 1;
                player.x = 200; player.y = rowY(14);
                spawnEnemy(200, rowY(14));
                eval(run)(0.1);
                eval(run)(DYING_TIME + 0.5);
                return { state, lives };
            }, [RUN]);
            expect(s.state).toBe('over');
            expect(s.lives).toBe(0);
        });

        test('the overlay reports game over', async ({ page }) => {
            await page.evaluate(() => {
                startGame();
                lives = 1;
                enemies.length = 0;
                player.x = 200; player.y = rowY(14);
                spawnEnemy(200, rowY(14));
                for (let t = 0; t < DYING_TIME + 1; t += 1 / 60) step(1 / 60);
            });
            await expect(page.locator('#overlay')).toHaveClass(/visible/);
            await expect(page.locator('#overlay-title')).toContainText(/game over/i);
        });

        test('the best score is stored after a game over', async ({ page }) => {
            const best = await page.evaluate(() => {
                startGame();
                enemies.length = 0;
                score = 1234;
                lives = 1;
                player.x = 200; player.y = rowY(14);
                spawnEnemy(200, rowY(14));
                for (let t = 0; t < DYING_TIME + 1; t += 1 / 60) step(1 / 60);
                return window.localStorage.getItem('burgertime-best');
            });
            expect(best).toBe('1234');
            await expect(page.locator('#best')).toHaveText('1234');
        });
    });

    // -----------------------------------------------------------------------
    // Pepper
    // -----------------------------------------------------------------------
    test.describe('pepper', () => {
        test('throwing pepper spends a shot and makes a cloud', async ({ page }) => {
            const s = await page.evaluate(() => {
                startGame();
                firePepper();
                return { peppers, clouds: clouds.length };
            });
            expect(s).toEqual({ peppers: 4, clouds: 1 });
        });

        test('Space throws pepper while running', async ({ page }) => {
            await page.keyboard.press('Space');            // start
            await page.keyboard.press('Space');            // throw
            expect(await page.evaluate(() => peppers)).toBe(4);
        });

        test('pepper cannot be thrown with an empty shaker', async ({ page }) => {
            const s = await page.evaluate(() => {
                startGame();
                peppers = 0;
                firePepper();
                return { peppers, clouds: clouds.length };
            });
            expect(s).toEqual({ peppers: 0, clouds: 0 });
        });

        test('a cloud fades away', async ({ page }) => {
            const remaining = await page.evaluate(([run]) => {
                startGame();
                enemies.length = 0;
                firePepper();
                eval(run)(CLOUD_TIME + 0.5);
                return clouds.length;
            }, [RUN]);
            expect(remaining).toBe(0);
        });

        test('pepper stuns an enemy in front of the chef', async ({ page }) => {
            const stun = await page.evaluate(() => {
                startGame();
                enemies.length = 0;
                player.x = 200; player.y = rowY(14); player.facing = 1;
                spawnEnemy(230, rowY(14));
                firePepper();
                return enemies[0].stun;
            });
            expect(stun).toBeGreaterThan(0);
        });

        test('a stunned enemy stops moving and is harmless', async ({ page }) => {
            const s = await page.evaluate(([run]) => {
                startGame();
                enemies.length = 0;
                player.x = 200; player.y = rowY(14); player.facing = 1;
                spawnEnemy(216, rowY(14));
                firePepper();
                const before = enemies[0].x;
                eval(run)(1);
                return { moved: Math.abs(enemies[0].x - before), state, lives };
            }, [RUN]);
            expect(s.moved).toBe(0);
            expect(s.state).toBe('running');
            expect(s.lives).toBe(3);
        });

        test('the stun wears off', async ({ page }) => {
            const stun = await page.evaluate(([run]) => {
                startGame();
                enemies.length = 0;
                player.x = 40; player.y = rowY(2);
                spawnEnemy(400, rowY(14));
                enemies[0].stun = 0.5;
                eval(run)(1);
                return enemies[0].stun;
            }, [RUN]);
            expect(stun).toBe(0);
        });
    });

    // -----------------------------------------------------------------------
    // Levels
    // -----------------------------------------------------------------------
    test.describe('levels', () => {
        test('plating every ingredient clears the level', async ({ page }) => {
            const s = await page.evaluate(([run]) => {
                startGame();
                enemies.length = 0;
                for (let i = 0; i < 400 && ingredients.some((ing) => !ing.onPlate); i++) {
                    ingredients.filter((ing) => !ing.onPlate && !ing.falling).forEach(startFall);
                    eval(run)(0.25);
                }
                return { state, plated: ingredients.filter((i) => i.onPlate).length, score };
            }, [RUN]);
            expect(s.plated).toBe(12);
            expect(s.state).toBe('levelclear');
            expect(s.score).toBeGreaterThanOrEqual(1000);
        });

        test('the next level rebuilds the burgers, adds pepper and an enemy', async ({ page }) => {
            const s = await page.evaluate(([run]) => {
                startGame();
                enemies.length = 0;
                for (let i = 0; i < 400 && ingredients.some((ing) => !ing.onPlate); i++) {
                    ingredients.filter((ing) => !ing.onPlate && !ing.falling).forEach(startFall);
                    eval(run)(0.25);
                }
                const peppersAtClear = peppers;
                eval(run)(LEVEL_CLEAR_TIME + 0.5);
                return {
                    state, level, peppers, peppersAtClear,
                    plated: ingredients.filter((i) => i.onPlate).length,
                    enemies: enemies.length,
                };
            }, [RUN]);
            expect(s.state).toBe('running');
            expect(s.level).toBe(2);
            expect(s.plated).toBe(0);
            expect(s.peppers).toBe(s.peppersAtClear + 1);
            expect(s.enemies).toBe(3);
        });

        test('enemies get faster with each level', async ({ page }) => {
            const s = await page.evaluate(() => [enemySpeed(1), enemySpeed(2), enemySpeed(9)]);
            expect(s[1]).toBeGreaterThan(s[0]);
            expect(s[2]).toBeGreaterThan(s[1]);
            expect(s[2]).toBeLessThan(200);
        });
    });

    // -----------------------------------------------------------------------
    // Pause, restart, rendering
    // -----------------------------------------------------------------------
    test.describe('pause and restart', () => {
        test('P pauses and resumes', async ({ page }) => {
            await page.keyboard.press('Space');
            await page.keyboard.press('KeyP');
            expect(await page.evaluate(() => state)).toBe('paused');
            await expect(page.locator('#overlay')).toHaveClass(/visible/);
            await page.keyboard.press('KeyP');
            expect(await page.evaluate(() => state)).toBe('running');
        });

        test('a paused game does not simulate', async ({ page }) => {
            const s = await page.evaluate(([run]) => {
                startGame();
                enemies.length = 0;
                player.x = 160; player.y = rowY(14);
                keys.right = true;
                togglePause();
                eval(run)(1);
                return { x: player.x, state };
            }, [RUN]);
            expect(s.x).toBe(160);
            expect(s.state).toBe('paused');
        });

        test('Space restarts after a game over', async ({ page }) => {
            await page.evaluate(() => {
                startGame();
                score = 500;
                lives = 1;
                enemies.length = 0;
                player.x = 200; player.y = rowY(14);
                spawnEnemy(200, rowY(14));
                for (let t = 0; t < DYING_TIME + 1; t += 1 / 60) step(1 / 60);
            });
            await page.keyboard.press('Space');
            const s = await page.evaluate(() => ({ state, score, lives }));
            expect(s).toEqual({ state: 'running', score: 0, lives: 3 });
        });
    });

    test.describe('presentation', () => {
        test('the HUD tracks the score', async ({ page }) => {
            await page.evaluate(() => {
                startGame();
                enemies.length = 0;
                startFall(ingredientAt(0, 11));
                for (let t = 0; t < 4; t += 1 / 60) step(1 / 60);
            });
            await expect(page.locator('#score')).toHaveText('50');
        });

        test('the canvas actually draws the level', async ({ page }) => {
            const distinct = await page.evaluate(() => {
                startGame();
                draw();
                const data = ctx.getImageData(0, 0, CANVAS_W, CANVAS_H).data;
                const seen = new Set();
                for (let i = 0; i < data.length; i += 4) {
                    seen.add(`${data[i]},${data[i + 1]},${data[i + 2]}`);
                }
                return seen.size;
            });
            expect(distinct).toBeGreaterThan(4);
        });

        test('the help text explains the controls', async ({ page }) => {
            await expect(page.locator('.help')).toContainText(/pepper/i);
            await expect(page.locator('.help')).toContainText(/climb/i);
        });
    });
});
