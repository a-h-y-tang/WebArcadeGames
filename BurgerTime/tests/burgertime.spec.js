const { test, expect } = require('@playwright/test');
const path = require('path');
const { pathToFileURL } = require('url');

const GAME_URL = pathToFileURL(path.resolve(__dirname, '../index.html')).href;

// Walks the chef across every piece of an ingredient, which is what makes it
// fall. Injected into the page so tests can express "walk this one over"
// without re-deriving the piece geometry each time.
const WALK = `
    function walk(ing) {
        chef.y = ing.y;
        for (let i = 0; i < PIECES; i++) {
            chef.x = ing.x + i * PIECE_W + PIECE_W / 2;
            step(0.001);
        }
    }
`;

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

        test('canvas is 600x500', async ({ page }) => {
            const canvas = page.locator('#canvas');
            await expect(canvas).toHaveAttribute('width', '600');
            await expect(canvas).toHaveAttribute('height', '500');
        });

        test('state is idle before starting', async ({ page }) => {
            expect(await page.evaluate(() => state)).toBe('idle');
        });

        test('the level is laid out with four burgers of four ingredients', async ({ page }) => {
            const info = await page.evaluate(() => ({
                total: ingredients.length,
                lanes: new Set(ingredients.map((i) => i.lane)).size,
                perLane: ingredients.filter((i) => i.lane === 0).length,
                onPlate: ingredients.filter((i) => i.onPlate).length,
            }));
            expect(info.total).toBe(16);
            expect(info.lanes).toBe(4);
            expect(info.perLane).toBe(4);
            expect(info.onPlate).toBe(0);
        });

        test('each ingredient starts on its own floor within its lane', async ({ page }) => {
            const unique = await page.evaluate(() => {
                const seen = new Set();
                for (const ing of ingredients) {
                    const key = ing.lane + ':' + ing.floorIdx;
                    if (seen.has(key)) return false;
                    seen.add(key);
                }
                return true;
            });
            expect(unique).toBe(true);
        });

        test('best score loads from localStorage', async ({ page }) => {
            await page.evaluate(() => window.localStorage.setItem('burgertime-best', '4200'));
            await page.reload();
            await expect(page.locator('#best')).toHaveText('4200');
        });
    });

    // -----------------------------------------------------------------------
    // Starting
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

        test('game starts on level 1 with 3 lives and a full pepper shaker', async ({ page }) => {
            const s = await page.evaluate(() => {
                startGame();
                return { level, lives, pepper, score, startPepper: START_PEPPER };
            });
            expect(s.level).toBe(1);
            expect(s.lives).toBe(3);
            expect(s.pepper).toBe(s.startPepper);
            expect(s.pepper).toBeGreaterThan(0);
            expect(s.score).toBe(0);
        });

        test('the chef starts standing on the plate floor', async ({ page }) => {
            const onPlateFloor = await page.evaluate(() => {
                startGame();
                return Math.abs(chef.y - PLATE_Y) < 0.001;
            });
            expect(onPlateFloor).toBe(true);
        });

        test('enemies are on the board once the game starts', async ({ page }) => {
            const count = await page.evaluate(() => {
                startGame();
                return enemies.length;
            });
            expect(count).toBeGreaterThan(0);
        });
    });

    // -----------------------------------------------------------------------
    // Chef movement
    // -----------------------------------------------------------------------
    test.describe('chef movement', () => {
        test('the chef walks right along a floor', async ({ page }) => {
            const { before, after } = await page.evaluate(() => {
                startGame();
                setChef(300, PLATE_Y);
                const before = chef.x;
                moveChef(1, 0);
                for (let i = 0; i < 10; i++) step(0.016);
                return { before, after: chef.x };
            });
            expect(after).toBeGreaterThan(before);
        });

        test('the chef walks left along a floor', async ({ page }) => {
            const { before, after } = await page.evaluate(() => {
                startGame();
                setChef(300, PLATE_Y);
                const before = chef.x;
                moveChef(-1, 0);
                for (let i = 0; i < 10; i++) step(0.016);
                return { before, after: chef.x };
            });
            expect(after).toBeLessThan(before);
        });

        test('the chef cannot walk off the ends of a floor', async ({ page }) => {
            const { left, right } = await page.evaluate(() => {
                startGame();
                setChef(FLOOR_X1, PLATE_Y);
                moveChef(-1, 0);
                for (let i = 0; i < 200; i++) step(0.016);
                const left = chef.x;
                setChef(FLOOR_X2, PLATE_Y);
                moveChef(1, 0);
                for (let i = 0; i < 200; i++) step(0.016);
                return { left, right: chef.x };
            });
            expect(left).toBeGreaterThanOrEqual(30);
            expect(right).toBeLessThanOrEqual(570);
        });

        test('the chef climbs a ladder', async ({ page }) => {
            const { before, after } = await page.evaluate(() => {
                startGame();
                const ladder = LADDERS.find((l) => Math.abs(l.y2 - PLATE_Y) < 0.001);
                setChef(ladder.x, PLATE_Y);
                const before = chef.y;
                moveChef(0, -1);
                for (let i = 0; i < 10; i++) step(0.016);
                return { before, after: chef.y };
            });
            expect(after).toBeLessThan(before);
        });

        test('the chef cannot climb where there is no ladder', async ({ page }) => {
            const { before, after } = await page.evaluate(() => {
                startGame();
                // Pick an x on the plate floor that no ladder reaches.
                let x = FLOOR_X1 + 5;
                while (LADDERS.some((l) => Math.abs(l.x - x) < 20)) x += 7;
                setChef(x, PLATE_Y);
                const before = chef.y;
                moveChef(0, -1);
                for (let i = 0; i < 10; i++) step(0.016);
                return { before, after: chef.y };
            });
            expect(after).toBe(before);
        });

        test('the chef cannot walk sideways off a ladder mid-climb', async ({ page }) => {
            const { before, after } = await page.evaluate(() => {
                startGame();
                const ladder = LADDERS.find((l) => Math.abs(l.y2 - PLATE_Y) < 0.001);
                setChef(ladder.x, (ladder.y1 + ladder.y2) / 2);
                const before = chef.x;
                moveChef(1, 0);
                for (let i = 0; i < 10; i++) step(0.016);
                return { before, after: chef.x };
            });
            expect(after).toBe(before);
        });

        test('climbing a ladder to the top leaves the chef on the floor above', async ({ page }) => {
            const onFloor = await page.evaluate(() => {
                startGame();
                const ladder = LADDERS.find((l) => Math.abs(l.y2 - PLATE_Y) < 0.001);
                setChef(ladder.x, PLATE_Y);
                moveChef(0, -1);
                for (let i = 0; i < 200; i++) step(0.016);
                return Math.abs(chef.y - ladder.y1) < 0.001;
            });
            expect(onFloor).toBe(true);
        });

        test('ArrowRight moves the chef right', async ({ page }) => {
            await page.evaluate(() => {
                startGame();
                setChef(300, PLATE_Y);
            });
            const before = await page.evaluate(() => chef.x);
            await page.keyboard.down('ArrowRight');
            await page.evaluate(() => {
                for (let i = 0; i < 10; i++) step(0.016);
            });
            await page.keyboard.up('ArrowRight');
            expect(await page.evaluate(() => chef.x)).toBeGreaterThan(before);
        });
    });

    // -----------------------------------------------------------------------
    // Walking ingredients down
    // -----------------------------------------------------------------------
    test.describe('ingredients', () => {
        test('walking over a piece marks it as stepped', async ({ page }) => {
            const stepped = await page.evaluate(() => {
                startGame();
                enemies.length = 0;
                const ing = ingredients.find((i) => i.lane === 0 && i.floorIdx === 3);
                chef.y = ing.y;
                chef.x = ing.x + PIECE_W / 2;
                step(0.001);
                return ing.pieces[0].stepped;
            });
            expect(stepped).toBe(true);
        });

        test('a partly-walked ingredient does not fall', async ({ page }) => {
            const result = await page.evaluate(() => {
                startGame();
                enemies.length = 0;
                const ing = ingredients.find((i) => i.lane === 0 && i.floorIdx === 3);
                chef.y = ing.y;
                for (let i = 0; i < PIECES - 1; i++) {
                    chef.x = ing.x + i * PIECE_W + PIECE_W / 2;
                    step(0.001);
                }
                return { falling: ing.falling, floorIdx: ing.floorIdx };
            });
            expect(result.falling).toBe(false);
            expect(result.floorIdx).toBe(3);
        });

        test('walking over every piece drops the ingredient one floor', async ({ page }) => {
            const floorIdx = await page.evaluate(
                `(() => {
                ${WALK}
                startGame();
                enemies.length = 0;
                const ing = ingredients.find((i) => i.lane === 0 && i.floorIdx === 3);
                walk(ing);
                for (let i = 0; i < 200; i++) step(0.016);
                return ing.floorIdx;
                })()`,
            );
            expect(floorIdx).toBe(4);
        });

        test('dropping an ingredient scores points', async ({ page }) => {
            const gained = await page.evaluate(
                `(() => {
                ${WALK}
                startGame();
                enemies.length = 0;
                score = 0;
                const ing = ingredients.find((i) => i.lane === 0 && i.floorIdx === 3);
                walk(ing);
                for (let i = 0; i < 200; i++) step(0.016);
                return score;
                })()`,
            );
            expect(gained).toBeGreaterThan(0);
        });

        test('pieces reset once the ingredient lands on a new floor', async ({ page }) => {
            const anyStepped = await page.evaluate(
                `(() => {
                ${WALK}
                startGame();
                enemies.length = 0;
                const ing = ingredients.find((i) => i.lane === 0 && i.floorIdx === 3);
                walk(ing);
                for (let i = 0; i < 200; i++) step(0.016);
                return ing.pieces.some((p) => p.stepped);
                })()`,
            );
            expect(anyStepped).toBe(false);
        });

        test('an ingredient falling onto a resting one knocks that one down too', async ({ page }) => {
            const result = await page.evaluate(
                `(() => {
                ${WALK}
                startGame();
                enemies.length = 0;
                const upper = ingredients.find((i) => i.lane === 0 && i.floorIdx === 2);
                const lower = ingredients.find((i) => i.lane === 0 && i.floorIdx === 3);
                walk(upper);
                for (let i = 0; i < 300; i++) step(0.016);
                return { upper: upper.floorIdx, lower: lower.floorIdx };
                })()`,
            );
            expect(result.upper).toBe(3);
            expect(result.lower).toBe(4);
        });

        test('an ingredient reaching the bottom lands on the plate', async ({ page }) => {
            const result = await page.evaluate(
                `(() => {
                ${WALK}
                startGame();
                enemies.length = 0;
                const ing = ingredients.find((i) => i.lane === 0 && i.floorIdx === 3);
                walk(ing);
                for (let i = 0; i < 300; i++) step(0.016);
                walk(ing);
                for (let i = 0; i < 300; i++) step(0.016);
                return { onPlate: ing.onPlate, stack: plates[0].count, y: ing.y };
                })()`,
            );
            expect(result.onPlate).toBe(true);
            expect(result.stack).toBe(1);
        });

        test('plated ingredients stack on top of each other', async ({ page }) => {
            const ys = await page.evaluate(() => {
                startGame();
                enemies.length = 0;
                const lane = ingredients.filter((i) => i.lane === 1);
                // Drop the lowest first so the stack builds bottom-up.
                lane.sort((a, b) => b.floorIdx - a.floorIdx);
                for (const ing of lane) {
                    while (!ing.onPlate) {
                        if (!ing.falling) dropIngredient(ing);
                        step(0.016);
                    }
                }
                return lane.map((i) => i.y);
            });
            expect(ys.length).toBe(4);
            for (let i = 1; i < ys.length; i++) {
                expect(ys[i]).toBeLessThan(ys[i - 1]);
            }
        });

        test('a plated ingredient can no longer be walked down', async ({ page }) => {
            const result = await page.evaluate(
                `(() => {
                ${WALK}
                startGame();
                enemies.length = 0;
                const ing = ingredients.find((i) => i.lane === 0 && i.floorIdx === 3);
                while (!ing.onPlate) { if (!ing.falling) dropIngredient(ing); step(0.016); }
                const y = ing.y;
                walk(ing);
                for (let i = 0; i < 100; i++) step(0.016);
                return { falling: ing.falling, sameY: ing.y === y };
                })()`,
            );
            expect(result.falling).toBe(false);
            expect(result.sameY).toBe(true);
        });
    });

    // -----------------------------------------------------------------------
    // Enemies
    // -----------------------------------------------------------------------
    test.describe('enemies', () => {
        test('enemies move around the level', async ({ page }) => {
            const moved = await page.evaluate(() => {
                startGame();
                // Track by index: losing a life rebuilds the enemy list, so a
                // captured reference could go stale.
                const x0 = enemies[0].x;
                const y0 = enemies[0].y;
                for (let i = 0; i < 120; i++) step(0.016);
                return Math.abs(enemies[0].x - x0) > 1 || Math.abs(enemies[0].y - y0) > 1;
            });
            expect(moved).toBe(true);
        });

        test('enemies stay inside the level bounds', async ({ page }) => {
            const inBounds = await page.evaluate(() => {
                startGame();
                for (let i = 0; i < 600; i++) {
                    step(0.016);
                    for (const e of enemies) {
                        if (e.x < FLOOR_X1 - 1 || e.x > FLOOR_X2 + 1) return false;
                        if (e.y < FLOOR_Y[0] - 1 || e.y > PLATE_Y + 1) return false;
                    }
                }
                return true;
            });
            expect(inBounds).toBe(true);
        });

        test('a falling ingredient squashes an enemy in its path', async ({ page }) => {
            const result = await page.evaluate(() => {
                startGame();
                enemies.length = 0;
                score = 0;
                const ing = ingredients.find((i) => i.lane === 0 && i.floorIdx === 3);
                const e = spawnEnemy(ing.x + 30, FLOOR_Y[4]);
                dropIngredient(ing);
                for (let i = 0; i < 200; i++) step(0.016);
                return { dead: e.dead, score };
            });
            expect(result.dead).toBe(true);
            expect(result.score).toBeGreaterThan(0);
        });

        test('a squashed enemy comes back after a delay', async ({ page }) => {
            const alive = await page.evaluate(() => {
                startGame();
                enemies.length = 0;
                const e = spawnEnemy(300, PLATE_Y);
                squashEnemy(e);
                for (let i = 0; i < 600; i++) step(0.016);
                return !e.dead;
            });
            expect(alive).toBe(true);
        });

        test('touching an enemy costs the chef a life', async ({ page }) => {
            const lives = await page.evaluate(() => {
                startGame();
                enemies.length = 0;
                setChef(300, PLATE_Y);
                spawnEnemy(300, PLATE_Y);
                for (let i = 0; i < 5; i++) step(0.016);
                return lives;
            });
            expect(lives).toBe(2);
        });

        test('losing the last life ends the game', async ({ page }) => {
            const s = await page.evaluate(() => {
                startGame();
                lives = 1;
                enemies.length = 0;
                setChef(300, PLATE_Y);
                spawnEnemy(300, PLATE_Y);
                for (let i = 0; i < 5; i++) step(0.016);
                return state;
            });
            expect(s).toBe('over');
        });

        test('the chef is briefly safe after respawning', async ({ page }) => {
            const lives = await page.evaluate(() => {
                startGame();
                enemies.length = 0;
                setChef(300, PLATE_Y);
                spawnEnemy(300, PLATE_Y);
                step(0.016);
                // Park an enemy on top of the chef again immediately.
                enemies.length = 0;
                spawnEnemy(chef.x, chef.y);
                step(0.016);
                return lives;
            });
            expect(lives).toBe(2);
        });
    });

    // -----------------------------------------------------------------------
    // Pepper
    // -----------------------------------------------------------------------
    test.describe('pepper', () => {
        test('using pepper stuns an enemy in front of the chef', async ({ page }) => {
            const result = await page.evaluate(() => {
                startGame();
                enemies.length = 0;
                setChef(300, PLATE_Y);
                chef.facing = 1;
                const e = spawnEnemy(330, PLATE_Y);
                const before = pepper;
                usePepper();
                return { before, after: pepper, stun: e.stun };
            });
            expect(result.after).toBe(result.before - 1);
            expect(result.stun).toBeGreaterThan(0);
        });

        test('pepper does not reach enemies behind the chef', async ({ page }) => {
            const stun = await page.evaluate(() => {
                startGame();
                enemies.length = 0;
                setChef(300, PLATE_Y);
                chef.facing = 1;
                const e = spawnEnemy(250, PLATE_Y);
                usePepper();
                return e.stun;
            });
            expect(stun).toBe(0);
        });

        test('a stunned enemy does not move', async ({ page }) => {
            const same = await page.evaluate(() => {
                startGame();
                enemies.length = 0;
                const e = spawnEnemy(300, PLATE_Y);
                e.stun = 5;
                const x0 = e.x;
                const y0 = e.y;
                for (let i = 0; i < 60; i++) step(0.016);
                return e.x === x0 && e.y === y0;
            });
            expect(same).toBe(true);
        });

        test('a stunned enemy cannot hurt the chef', async ({ page }) => {
            const lives = await page.evaluate(() => {
                startGame();
                enemies.length = 0;
                setChef(300, PLATE_Y);
                const e = spawnEnemy(300, PLATE_Y);
                e.stun = 5;
                for (let i = 0; i < 20; i++) step(0.016);
                return lives;
            });
            expect(lives).toBe(3);
        });

        test('pepper cannot be used when the shaker is empty', async ({ page }) => {
            const result = await page.evaluate(() => {
                startGame();
                enemies.length = 0;
                pepper = 0;
                setChef(300, PLATE_Y);
                chef.facing = 1;
                const e = spawnEnemy(330, PLATE_Y);
                usePepper();
                return { pepper, stun: e.stun };
            });
            expect(result.pepper).toBe(0);
            expect(result.stun).toBe(0);
        });

        test('the stun wears off', async ({ page }) => {
            const stun = await page.evaluate(() => {
                startGame();
                enemies.length = 0;
                const e = spawnEnemy(300, PLATE_Y);
                e.stun = 0.5;
                for (let i = 0; i < 60; i++) step(0.016);
                return e.stun;
            });
            expect(stun).toBeLessThanOrEqual(0);
        });
    });

    // -----------------------------------------------------------------------
    // Levels
    // -----------------------------------------------------------------------
    test.describe('levels', () => {
        test('plating every ingredient advances to the next level', async ({ page }) => {
            const result = await page.evaluate(() => {
                startGame();
                enemies.length = 0;
                for (let round = 0; round < 10 && level === 1; round++) {
                    for (const ing of ingredients.slice()) {
                        if (!ing.onPlate && !ing.falling) dropIngredient(ing);
                    }
                    for (let i = 0; i < 200 && level === 1; i++) step(0.016);
                }
                return { level, plated: ingredients.filter((i) => i.onPlate).length };
            });
            expect(result.level).toBe(2);
            expect(result.plated).toBe(0);
        });

        test('completing a level awards a bonus and more pepper', async ({ page }) => {
            const result = await page.evaluate(() => {
                startGame();
                enemies.length = 0;
                const pepper0 = pepper;
                score = 0;
                for (let round = 0; round < 10 && level === 1; round++) {
                    for (const ing of ingredients.slice()) {
                        if (!ing.onPlate && !ing.falling) dropIngredient(ing);
                    }
                    for (let i = 0; i < 200 && level === 1; i++) step(0.016);
                }
                return { score, pepper0, pepper, bonus: LEVEL_BONUS };
            });
            expect(result.score).toBeGreaterThanOrEqual(result.bonus);
            expect(result.pepper).toBeGreaterThan(result.pepper0);
        });

        test('enemies get faster on later levels', async ({ page }) => {
            const { slow, fast } = await page.evaluate(() => {
                startGame();
                const slow = enemySpeed();
                level = 4;
                return { slow, fast: enemySpeed() };
            });
            expect(fast).toBeGreaterThan(slow);
        });
    });

    // -----------------------------------------------------------------------
    // Pause, restart, scoring
    // -----------------------------------------------------------------------
    test.describe('pause and restart', () => {
        test('pausing freezes falling ingredients', async ({ page }) => {
            const same = await page.evaluate(() => {
                startGame();
                enemies.length = 0;
                const ing = ingredients.find((i) => i.lane === 0 && i.floorIdx === 3);
                dropIngredient(ing);
                togglePause();
                const y0 = ing.y;
                for (let i = 0; i < 20; i++) step(0.016);
                return ing.y === y0;
            });
            expect(same).toBe(true);
        });

        test('resuming lets the game run again', async ({ page }) => {
            const moved = await page.evaluate(() => {
                startGame();
                enemies.length = 0;
                const ing = ingredients.find((i) => i.lane === 0 && i.floorIdx === 3);
                dropIngredient(ing);
                togglePause();
                togglePause();
                const y0 = ing.y;
                for (let i = 0; i < 10; i++) step(0.016);
                return ing.y > y0;
            });
            expect(moved).toBe(true);
        });

        test('restarting resets score, level, lives and the burgers', async ({ page }) => {
            const result = await page.evaluate(() => {
                startGame();
                score = 5000;
                level = 4;
                lives = 1;
                dropIngredient(ingredients[0]);
                endGame();
                startGame();
                return {
                    score,
                    level,
                    lives,
                    state,
                    plated: ingredients.filter((i) => i.onPlate).length,
                    falling: ingredients.filter((i) => i.falling).length,
                };
            });
            expect(result.score).toBe(0);
            expect(result.level).toBe(1);
            expect(result.lives).toBe(3);
            expect(result.state).toBe('running');
            expect(result.plated).toBe(0);
            expect(result.falling).toBe(0);
        });
    });

    test.describe('scoring', () => {
        test('best score updates on game over when beaten', async ({ page }) => {
            await page.evaluate(() => {
                startGame();
                score = 7350;
                updateHud();
                endGame();
            });
            await expect(page.locator('#best')).toHaveText('7350');
        });

        test('best score persists to localStorage', async ({ page }) => {
            await page.evaluate(() => {
                startGame();
                score = 1234;
                updateHud();
                endGame();
            });
            const stored = await page.evaluate(() => window.localStorage.getItem('burgertime-best'));
            expect(parseInt(stored, 10)).toBe(1234);
        });

        test('best score is not lowered by a worse run', async ({ page }) => {
            await page.evaluate(() => window.localStorage.setItem('burgertime-best', '9999'));
            await page.reload();
            await page.evaluate(() => {
                startGame();
                score = 5;
                updateHud();
                endGame();
            });
            await expect(page.locator('#best')).toHaveText('9999');
        });

        test('game over shows the overlay with Play Again', async ({ page }) => {
            await page.evaluate(() => {
                startGame();
                endGame();
            });
            await expect(page.locator('#overlay')).toHaveClass(/visible/);
            await expect(page.locator('#btn-start')).toHaveText('Play Again');
        });

        test('the HUD tracks score, level, lives and pepper', async ({ page }) => {
            await page.evaluate(() => {
                startGame();
                score = 800;
                level = 3;
                lives = 2;
                pepper = 4;
                updateHud();
            });
            await expect(page.locator('#score')).toHaveText('800');
            await expect(page.locator('#level')).toHaveText('3');
            await expect(page.locator('#lives')).toHaveText('2');
            await expect(page.locator('#pepper')).toHaveText('4');
        });
    });
});
