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

        test('score, level, lives and best show their starting values', async ({ page }) => {
            await expect(page.locator('#score')).toHaveText('0');
            await expect(page.locator('#level')).toHaveText('1');
            await expect(page.locator('#lives')).toHaveText('3');
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

        test('game starts on level 1 with full lives and pepper', async ({ page }) => {
            const s = await page.evaluate(() => {
                startGame();
                return { level, lives, score, pepper, start: START_PEPPER, startLives: START_LIVES };
            });
            expect(s.level).toBe(1);
            expect(s.lives).toBe(s.startLives);
            expect(s.score).toBe(0);
            expect(s.pepper).toBe(s.start);
        });

        test('the level holds four burgers of four ingredients each', async ({ page }) => {
            const s = await page.evaluate(() => {
                startGame();
                return {
                    total: ingredients.length,
                    columns: COLUMN_XS.length,
                    perColumn: ING_PER_COLUMN,
                    idle: ingredients.every((i) => i.state === 'idle'),
                    unflipped: ingredients.every((i) => i.segments.every((s) => s === false)),
                };
            });
            expect(s.columns).toBe(4);
            expect(s.perColumn).toBe(4);
            expect(s.total).toBe(16);
            expect(s.idle).toBe(true);
            expect(s.unflipped).toBe(true);
        });

        test('the chef starts on the bottom floor inside the play field', async ({ page }) => {
            const ok = await page.evaluate(() => {
                startGame();
                return chef.y === FLOOR_YS[FLOOR_YS.length - 1]
                    && chef.x > 0 && chef.x < CANVAS_W;
            });
            expect(ok).toBe(true);
        });

        test('enemies are on the board at the start of a level', async ({ page }) => {
            const n = await page.evaluate(() => { startGame(); return enemies.length; });
            expect(n).toBeGreaterThan(0);
        });
    });

    // -----------------------------------------------------------------------
    // Chef movement
    // -----------------------------------------------------------------------
    test.describe('chef movement', () => {
        test('walking right increases the chef x', async ({ page }) => {
            const { before, after } = await page.evaluate(() => {
                startGame();
                placeChef(300, FLOOR_YS[5]);
                const before = chef.x;
                setChefDir(1, 0);
                for (let i = 0; i < 10; i++) step(0.016);
                return { before, after: chef.x };
            });
            expect(after).toBeGreaterThan(before);
        });

        test('walking left decreases the chef x', async ({ page }) => {
            const { before, after } = await page.evaluate(() => {
                startGame();
                placeChef(300, FLOOR_YS[5]);
                const before = chef.x;
                setChefDir(-1, 0);
                for (let i = 0; i < 10; i++) step(0.016);
                return { before, after: chef.x };
            });
            expect(after).toBeLessThan(before);
        });

        test('the chef cannot walk off either edge', async ({ page }) => {
            const { left, right, w } = await page.evaluate(() => {
                startGame();
                clearEnemies();
                placeChef(300, FLOOR_YS[5]);
                setChefDir(-1, 0);
                for (let i = 0; i < 400; i++) step(0.016);
                const left = chef.x;
                setChefDir(1, 0);
                for (let i = 0; i < 800; i++) step(0.016);
                return { left, right: chef.x, w: CANVAS_W };
            });
            expect(left).toBeGreaterThanOrEqual(0);
            expect(right).toBeLessThanOrEqual(w);
        });

        test('the chef climbs up at a ladder', async ({ page }) => {
            const { before, after } = await page.evaluate(() => {
                startGame();
                placeChef(LADDER_XS[2], FLOOR_YS[5]);
                const before = chef.y;
                setChefDir(0, -1);
                for (let i = 0; i < 20; i++) step(0.016);
                return { before, after: chef.y };
            });
            expect(after).toBeLessThan(before);
        });

        test('the chef cannot climb away from a ladder', async ({ page }) => {
            const { before, after } = await page.evaluate(() => {
                startGame();
                placeChef(100, FLOOR_YS[5]);
                const before = chef.y;
                setChefDir(0, -1);
                for (let i = 0; i < 20; i++) step(0.016);
                return { before, after: chef.y };
            });
            expect(after).toBe(before);
        });

        test('the chef cannot climb above the top floor or below the bottom floor', async ({ page }) => {
            const { top, bottom } = await page.evaluate(() => {
                startGame();
                // Long run: keep enemies out of it so this measures clamping only.
                clearEnemies();
                placeChef(LADDER_XS[2], FLOOR_YS[5]);
                setChefDir(0, -1);
                for (let i = 0; i < 600; i++) step(0.016);
                const top = chef.y;
                setChefDir(0, 1);
                for (let i = 0; i < 900; i++) step(0.016);
                return { top, bottom: chef.y };
            });
            expect(top).toBe(80);
            expect(bottom).toBe(430);
        });

        test('the chef can only walk while standing on a floor', async ({ page }) => {
            const { before, after } = await page.evaluate(() => {
                startGame();
                // Park the chef halfway up a ladder, between two floors.
                placeChef(LADDER_XS[2], (FLOOR_YS[4] + FLOOR_YS[5]) / 2);
                const before = chef.x;
                setChefDir(1, 0);
                for (let i = 0; i < 20; i++) step(0.016);
                return { before, after: chef.x };
            });
            expect(after).toBe(before);
        });

        test('the ArrowRight key walks the chef right', async ({ page }) => {
            await page.evaluate(() => { startGame(); placeChef(300, FLOOR_YS[5]); });
            const before = await page.evaluate(() => chef.x);
            await page.keyboard.down('ArrowRight');
            await page.evaluate(() => { for (let i = 0; i < 10; i++) step(0.016); });
            await page.keyboard.up('ArrowRight');
            const after = await page.evaluate(() => chef.x);
            expect(after).toBeGreaterThan(before);
        });
    });

    // -----------------------------------------------------------------------
    // Ingredients
    // -----------------------------------------------------------------------
    test.describe('ingredients', () => {
        test('standing on a segment presses it down', async ({ page }) => {
            const segments = await page.evaluate(() => {
                startGame();
                const ing = ingredients[0];
                placeChef(ing.x + SEG_W / 2, ing.y);
                step(0.016);
                return ing.segments.slice();
            });
            expect(segments[0]).toBe(true);
            expect(segments[1]).toBe(false);
        });

        test('a partly pressed ingredient does not fall', async ({ page }) => {
            const s = await page.evaluate(() => {
                startGame();
                const ing = ingredients[0];
                placeChef(ing.x + SEG_W / 2, ing.y);
                for (let i = 0; i < 5; i++) step(0.016);
                return ing.state;
            });
            expect(s).toBe('idle');
        });

        test('pressing all four segments makes the ingredient fall', async ({ page }) => {
            const s = await page.evaluate(() => {
                startGame();
                const ing = ingredients[0];
                for (let i = 0; i < SEGMENTS; i++) {
                    placeChef(ing.x + SEG_W * (i + 0.5), ing.y);
                    step(0.016);
                }
                return ing.state;
            });
            expect(s).toBe('falling');
        });

        test('a falling ingredient descends over time', async ({ page }) => {
            const { before, after } = await page.evaluate(() => {
                startGame();
                const ing = ingredients[0];
                dropIngredient(ing);
                const before = ing.y;
                for (let i = 0; i < 5; i++) step(0.016);
                return { before, after: ing.y };
            });
            expect(after).toBeGreaterThan(before);
        });

        test('a falling ingredient lands on its plate and counts toward the burger', async ({ page }) => {
            const r = await page.evaluate(() => {
                startGame();
                const ing = ingredients.find((i) => i.col === 0 && i.row === 3);
                dropIngredient(ing);
                for (let i = 0; i < 300; i++) step(0.016);
                return { state: ing.state, y: ing.y, plate: PLATE_Y, landed: columnLanded(0) };
            });
            expect(r.state).toBe('landed');
            expect(r.y).toBe(r.plate);
            expect(r.landed).toBe(1);
        });

        test('landing an ingredient scores points', async ({ page }) => {
            const r = await page.evaluate(() => {
                startGame();
                score = 0;
                const ing = ingredients.find((i) => i.col === 0 && i.row === 3);
                dropIngredient(ing);
                for (let i = 0; i < 300; i++) step(0.016);
                return { score, drop: DROP_POINTS };
            });
            expect(r.score).toBe(r.drop);
        });

        test('a falling ingredient knocks loose the resting one below it', async ({ page }) => {
            const s = await page.evaluate(() => {
                startGame();
                const top = ingredients.find((i) => i.col === 1 && i.row === 0);
                const below = ingredients.find((i) => i.col === 1 && i.row === 1);
                dropIngredient(top);
                for (let i = 0; i < 120; i++) step(0.016);
                return below.state;
            });
            expect(s).not.toBe('idle');
        });

        test('ingredients stack on the plate in landing order', async ({ page }) => {
            const r = await page.evaluate(() => {
                startGame();
                const first = ingredients.find((i) => i.col === 2 && i.row === 3);
                const second = ingredients.find((i) => i.col === 2 && i.row === 2);
                dropIngredient(first);
                for (let i = 0; i < 300; i++) step(0.016);
                dropIngredient(second);
                for (let i = 0; i < 300; i++) step(0.016);
                return { first: first.y, second: second.y, plate: PLATE_Y, h: ING_H, landed: columnLanded(2) };
            });
            expect(r.first).toBe(r.plate);
            expect(r.second).toBe(r.plate - r.h);
            expect(r.landed).toBe(2);
        });

        test('an ingredient that has landed cannot be pressed again', async ({ page }) => {
            const r = await page.evaluate(() => {
                startGame();
                const ing = ingredients.find((i) => i.col === 0 && i.row === 3);
                dropIngredient(ing);
                for (let i = 0; i < 300; i++) step(0.016);
                const y = ing.y;
                placeChef(ing.x + SEG_W / 2, ing.y);
                for (let i = 0; i < 10; i++) step(0.016);
                return { y, after: ing.y, state: ing.state };
            });
            expect(r.state).toBe('landed');
            expect(r.after).toBe(r.y);
        });
    });

    // -----------------------------------------------------------------------
    // Enemies
    // -----------------------------------------------------------------------
    test.describe('enemies', () => {
        test('an enemy that touches the chef costs a life', async ({ page }) => {
            const lives = await page.evaluate(() => {
                startGame();
                enemies.length = 0;
                spawnEnemyAt(chef.x, chef.y);
                step(0.016);
                return lives;
            });
            expect(lives).toBe(2);
        });

        test('a death resets the chef to the starting position', async ({ page }) => {
            const r = await page.evaluate(() => {
                startGame();
                placeChef(500, FLOOR_YS[0]);
                enemies.length = 0;
                spawnEnemyAt(chef.x, chef.y);
                step(0.016);
                return { x: chef.x, y: chef.y, startY: FLOOR_YS[FLOOR_YS.length - 1] };
            });
            expect(r.y).toBe(r.startY);
            expect(r.x).toBe(300);
        });

        test('losing the last life ends the game', async ({ page }) => {
            const s = await page.evaluate(() => {
                startGame();
                lives = 1;
                enemies.length = 0;
                spawnEnemyAt(chef.x, chef.y);
                step(0.016);
                return state;
            });
            expect(s).toBe('over');
        });

        test('enemies walk toward the chef', async ({ page }) => {
            const { before, after } = await page.evaluate(() => {
                startGame();
                placeChef(60, FLOOR_YS[5]);
                enemies.length = 0;
                const e = spawnEnemyAt(540, FLOOR_YS[5]);
                const before = e.x;
                for (let i = 0; i < 30; i++) step(0.016);
                return { before, after: e.x };
            });
            expect(after).toBeLessThan(before);
        });

        test('enemies climb toward a chef on another floor', async ({ page }) => {
            const climbed = await page.evaluate(() => {
                startGame();
                placeChef(LADDER_XS[2], FLOOR_YS[0]);
                enemies.length = 0;
                const e = spawnEnemyAt(LADDER_XS[2], FLOOR_YS[3]);
                const before = e.y;
                for (let i = 0; i < 60; i++) step(0.016);
                return e.y < before;
            });
            expect(climbed).toBe(true);
        });

        test('a stunned enemy does not move', async ({ page }) => {
            const { before, after } = await page.evaluate(() => {
                startGame();
                placeChef(60, FLOOR_YS[5]);
                enemies.length = 0;
                const e = spawnEnemyAt(540, FLOOR_YS[5]);
                e.stun = 3;
                const before = e.x;
                for (let i = 0; i < 30; i++) step(0.016);
                return { before, after: e.x };
            });
            expect(after).toBe(before);
        });

        test('a stun wears off', async ({ page }) => {
            const stun = await page.evaluate(() => {
                startGame();
                enemies.length = 0;
                const e = spawnEnemyAt(540, FLOOR_YS[5]);
                e.stun = 0.1;
                for (let i = 0; i < 20; i++) step(0.016);
                return e.stun;
            });
            expect(stun).toBe(0);
        });

        test('a falling ingredient squashes an enemy under it', async ({ page }) => {
            const r = await page.evaluate(() => {
                startGame();
                score = 0;
                placeChef(60, FLOOR_YS[5]);
                enemies.length = 0;
                const ing = ingredients.find((i) => i.col === 3 && i.row === 0);
                spawnEnemyAt(ing.x + ING_W / 2, FLOOR_YS[1]);
                dropIngredient(ing);
                for (let i = 0; i < 120; i++) step(0.016);
                return { enemies: enemies.length, score, squash: SQUASH_POINTS };
            });
            expect(r.enemies).toBe(0);
            expect(r.score).toBeGreaterThanOrEqual(r.squash);
        });
    });

    // -----------------------------------------------------------------------
    // Pepper
    // -----------------------------------------------------------------------
    test.describe('pepper', () => {
        test('spraying uses one shaker', async ({ page }) => {
            const r = await page.evaluate(() => {
                startGame();
                const before = pepper;
                sprayPepper();
                return { before, after: pepper };
            });
            expect(r.after).toBe(r.before - 1);
        });

        test('pepper stuns an enemy in front of the chef', async ({ page }) => {
            const stun = await page.evaluate(() => {
                startGame();
                placeChef(300, FLOOR_YS[5]);
                setChefDir(1, 0);
                step(0.016);
                enemies.length = 0;
                const e = spawnEnemyAt(320, FLOOR_YS[5]);
                sprayPepper();
                return e.stun;
            });
            expect(stun).toBeGreaterThan(0);
        });

        test('pepper does not reach an enemy behind the chef', async ({ page }) => {
            const stun = await page.evaluate(() => {
                startGame();
                placeChef(300, FLOOR_YS[5]);
                setChefDir(1, 0);
                step(0.016);
                enemies.length = 0;
                const e = spawnEnemyAt(240, FLOOR_YS[5]);
                sprayPepper();
                return e.stun;
            });
            expect(stun).toBe(0);
        });

        test('pepper does not reach an enemy on another floor', async ({ page }) => {
            const stun = await page.evaluate(() => {
                startGame();
                placeChef(300, FLOOR_YS[5]);
                setChefDir(1, 0);
                step(0.016);
                enemies.length = 0;
                const e = spawnEnemyAt(320, FLOOR_YS[4]);
                sprayPepper();
                return e.stun;
            });
            expect(stun).toBe(0);
        });

        test('an empty shaker sprays nothing', async ({ page }) => {
            const r = await page.evaluate(() => {
                startGame();
                pepper = 0;
                placeChef(300, FLOOR_YS[5]);
                setChefDir(1, 0);
                step(0.016);
                enemies.length = 0;
                const e = spawnEnemyAt(320, FLOOR_YS[5]);
                sprayPepper();
                return { stun: e.stun, pepper };
            });
            expect(r.stun).toBe(0);
            expect(r.pepper).toBe(0);
        });

        test('the Space key sprays while playing', async ({ page }) => {
            await page.evaluate(() => { startGame(); });
            const before = await page.evaluate(() => pepper);
            await page.keyboard.press('Space');
            const after = await page.evaluate(() => pepper);
            expect(after).toBe(before - 1);
        });
    });

    // -----------------------------------------------------------------------
    // Levels
    // -----------------------------------------------------------------------
    test.describe('levels', () => {
        test('building every burger clears the level', async ({ page }) => {
            const r = await page.evaluate(() => {
                startGame();
                score = 0;
                ingredients.forEach(dropIngredient);
                for (let i = 0; i < 400; i++) step(0.016);
                return { level, score, bonus: LEVEL_BONUS, drop: DROP_POINTS };
            });
            expect(r.level).toBe(2);
            expect(r.score).toBeGreaterThanOrEqual(r.bonus + 16 * r.drop);
        });

        test('a new level rebuilds the burgers and adds pepper', async ({ page }) => {
            const r = await page.evaluate(() => {
                startGame();
                const pepperBefore = pepper;
                ingredients.forEach(dropIngredient);
                for (let i = 0; i < 400; i++) step(0.016);
                return {
                    total: ingredients.length,
                    idle: ingredients.every((i) => i.state === 'idle'),
                    landed: columnLanded(0),
                    pepperBefore,
                    pepper,
                };
            });
            expect(r.total).toBe(16);
            expect(r.idle).toBe(true);
            expect(r.landed).toBe(0);
            expect(r.pepper).toBe(r.pepperBefore + 1);
        });

        test('a new level keeps the score and lives', async ({ page }) => {
            const r = await page.evaluate(() => {
                startGame();
                lives = 2;
                ingredients.forEach(dropIngredient);
                for (let i = 0; i < 400; i++) step(0.016);
                return { lives, score };
            });
            expect(r.lives).toBe(2);
            expect(r.score).toBeGreaterThan(0);
        });

        test('enemies get faster on later levels', async ({ page }) => {
            const r = await page.evaluate(() => {
                const l1 = enemySpeedFor(1);
                const l4 = enemySpeedFor(4);
                return { l1, l4 };
            });
            expect(r.l4).toBeGreaterThan(r.l1);
        });
    });

    // -----------------------------------------------------------------------
    // Scoring & best
    // -----------------------------------------------------------------------
    test.describe('scoring', () => {
        test('best score updates on game over when beaten', async ({ page }) => {
            await page.evaluate(() => {
                startGame();
                score = 2750;
                updateHud();
                endGame();
            });
            await expect(page.locator('#best')).toHaveText('2750');
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
            await page.evaluate(() => window.localStorage.setItem('burgertime-best', '9000'));
            await page.reload();
            await page.evaluate(() => {
                startGame();
                score = 10;
                updateHud();
                endGame();
            });
            await expect(page.locator('#best')).toHaveText('9000');
        });

        test('game over shows the overlay with Play Again', async ({ page }) => {
            await page.evaluate(() => { startGame(); endGame(); });
            await expect(page.locator('#overlay')).toHaveClass(/visible/);
            await expect(page.locator('#btn-start')).toHaveText('Play Again');
        });

        test('the HUD tracks score, lives and pepper', async ({ page }) => {
            await page.evaluate(() => {
                startGame();
                score = 700;
                lives = 2;
                pepper = 1;
                updateHud();
            });
            await expect(page.locator('#score')).toHaveText('700');
            await expect(page.locator('#lives')).toHaveText('2');
            await expect(page.locator('#pepper')).toHaveText('1');
        });
    });

    // -----------------------------------------------------------------------
    // Pause & restart
    // -----------------------------------------------------------------------
    test.describe('pause and restart', () => {
        test('pausing freezes a falling ingredient', async ({ page }) => {
            const { before, after } = await page.evaluate(() => {
                startGame();
                const ing = ingredients[0];
                dropIngredient(ing);
                togglePause();
                const before = ing.y;
                for (let i = 0; i < 10; i++) step(0.016);
                return { before, after: ing.y };
            });
            expect(after).toBe(before);
        });

        test('resuming lets it fall again', async ({ page }) => {
            const moved = await page.evaluate(() => {
                startGame();
                const ing = ingredients[0];
                dropIngredient(ing);
                togglePause();
                togglePause();
                const before = ing.y;
                for (let i = 0; i < 10; i++) step(0.016);
                return ing.y > before;
            });
            expect(moved).toBe(true);
        });

        test('the P key pauses and resumes', async ({ page }) => {
            await page.evaluate(() => startGame());
            await page.keyboard.press('p');
            expect(await page.evaluate(() => state)).toBe('paused');
            await page.keyboard.press('p');
            expect(await page.evaluate(() => state)).toBe('running');
        });

        test('restart after game over resets score, level, lives and burgers', async ({ page }) => {
            const r = await page.evaluate(() => {
                startGame();
                score = 5000;
                level = 4;
                lives = 1;
                ingredients[0].state = 'falling';
                endGame();
                startGame();
                return {
                    score, level, lives, state,
                    idle: ingredients.every((i) => i.state === 'idle'),
                    landed: columnLanded(0),
                };
            });
            expect(r.score).toBe(0);
            expect(r.level).toBe(1);
            expect(r.lives).toBe(3);
            expect(r.state).toBe('running');
            expect(r.idle).toBe(true);
            expect(r.landed).toBe(0);
        });
    });
});
