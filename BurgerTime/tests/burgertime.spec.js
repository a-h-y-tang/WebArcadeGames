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

        test('HUD starts at zero score, three lives, level 1, five peppers', async ({ page }) => {
            await expect(page.locator('#score')).toHaveText('0');
            await expect(page.locator('#lives')).toHaveText('3');
            await expect(page.locator('#level')).toHaveText('1');
            await expect(page.locator('#peppers')).toHaveText('5');
            await expect(page.locator('#best')).toHaveText('0');
        });

        test('canvas is 672x480', async ({ page }) => {
            const canvas = page.locator('#canvas');
            await expect(canvas).toHaveAttribute('width', '672');
            await expect(canvas).toHaveAttribute('height', '480');
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
        test('there are five girder rows including the plate row', async ({ page }) => {
            expect(await page.evaluate(() => PLATFORM_ROWS.length)).toBe(5);
        });

        test('girder heights are strictly increasing down the screen', async ({ page }) => {
            const ys = await page.evaluate(() => PLATFORM_ROWS.map((_, i) => platformY(i)));
            for (let i = 1; i < ys.length; i++) expect(ys[i]).toBeGreaterThan(ys[i - 1]);
        });

        test('four burgers of four ingredients each', async ({ page }) => {
            const counts = await page.evaluate(() => {
                startGame();
                return [0, 1, 2, 3].map((c) => ingredients.filter((i) => i.col === c).length);
            });
            expect(counts).toEqual([4, 4, 4, 4]);
        });

        test('each burger starts stacked on levels 0-3', async ({ page }) => {
            const levels = await page.evaluate(() => {
                startGame();
                return ingredients.filter((i) => i.col === 0).map((i) => i.level).sort();
            });
            expect(levels).toEqual([0, 1, 2, 3]);
        });

        test('no ingredient starts on a plate', async ({ page }) => {
            const onPlate = await page.evaluate(() => {
                startGame();
                return ingredients.filter((i) => i.onPlate).length;
            });
            expect(onPlate).toBe(0);
        });

        test('every ladder segment starts and ends on a girder', async ({ page }) => {
            const ok = await page.evaluate(() => {
                const ys = PLATFORM_ROWS.map((_, i) => platformY(i));
                return LADDER_SEGMENTS.every((s) => ys.includes(s.topY) && ys.includes(s.bottomY));
            });
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

        test('startGame resets score, lives, level and peppers', async ({ page }) => {
            const s = await page.evaluate(() => {
                startGame();
                score = 999; lives = 1; level = 4; peppers = 0;
                startGame();
                return { score, lives, level, peppers };
            });
            expect(s).toEqual({ score: 0, lives: 3, level: 1, peppers: 5 });
        });

        test('enemies spawn when the game starts', async ({ page }) => {
            const n = await page.evaluate(() => { startGame(); return enemies.length; });
            expect(n).toBeGreaterThanOrEqual(2);
        });

        test('the chef starts standing on a girder', async ({ page }) => {
            const onGirder = await page.evaluate(() => {
                startGame();
                return PLATFORM_ROWS.map((_, i) => platformY(i)).includes(player.y);
            });
            expect(onGirder).toBe(true);
        });
    });

    // -----------------------------------------------------------------------
    // Walking and climbing
    // -----------------------------------------------------------------------
    test.describe('movement', () => {
        test('walking right increases x', async ({ page }) => {
            const d = await page.evaluate(() => {
                startGame();
                enemies.length = 0;
                setPlayerPos(336, platformY(4));
                const before = player.x;
                setDirection(1, 0);
                for (let i = 0; i < 10; i++) step(0.016);
                return player.x - before;
            });
            expect(d).toBeGreaterThan(0);
        });

        test('walking left decreases x', async ({ page }) => {
            const d = await page.evaluate(() => {
                startGame();
                enemies.length = 0;
                setPlayerPos(336, platformY(4));
                const before = player.x;
                setDirection(-1, 0);
                for (let i = 0; i < 10; i++) step(0.016);
                return player.x - before;
            });
            expect(d).toBeLessThan(0);
        });

        test('the chef cannot walk off the left edge', async ({ page }) => {
            const x = await page.evaluate(() => {
                startGame();
                enemies.length = 0;
                setPlayerPos(60, platformY(4));
                setDirection(-1, 0);
                for (let i = 0; i < 400; i++) step(0.016);
                return player.x;
            });
            expect(x).toBeGreaterThanOrEqual(0);
            expect(x).toBeLessThanOrEqual(32);
        });

        test('the chef cannot walk off the right edge', async ({ page }) => {
            const r = await page.evaluate(() => {
                startGame();
                enemies.length = 0;
                setPlayerPos(600, platformY(4));
                setDirection(1, 0);
                for (let i = 0; i < 400; i++) step(0.016);
                return { x: player.x, width: CANVAS_W };
            });
            expect(r.x).toBeLessThanOrEqual(r.width);
            expect(r.x).toBeGreaterThanOrEqual(r.width - 32);
        });

        test('the chef climbs down a ladder', async ({ page }) => {
            const r = await page.evaluate(() => {
                startGame();
                enemies.length = 0;
                setPlayerPos(16, platformY(0));
                setDirection(0, 1);
                for (let i = 0; i < 20; i++) step(0.016);
                return { y: player.y, top: platformY(0), next: platformY(1) };
            });
            expect(r.y).toBeGreaterThan(r.top);
            expect(r.y).toBeLessThanOrEqual(r.next);
        });

        test('climbing snaps the chef onto the ladder centre', async ({ page }) => {
            const x = await page.evaluate(() => {
                startGame();
                enemies.length = 0;
                setPlayerPos(24, platformY(0));
                setDirection(0, 1);
                step(0.016);
                return player.x;
            });
            expect(x).toBe(16);
        });

        test('the chef cannot climb where there is no ladder', async ({ page }) => {
            const moved = await page.evaluate(() => {
                startGame();
                enemies.length = 0;
                setPlayerPos(336, platformY(0)); // middle column has no ladder on the top floor
                const before = player.y;
                setDirection(0, 1);
                for (let i = 0; i < 30; i++) step(0.016);
                return player.y !== before;
            });
            expect(moved).toBe(false);
        });

        test('the chef cannot climb above the top girder', async ({ page }) => {
            const y = await page.evaluate(() => {
                startGame();
                enemies.length = 0;
                setPlayerPos(16, platformY(0));
                setDirection(0, -1);
                for (let i = 0; i < 30; i++) step(0.016);
                return player.y;
            });
            expect(y).toBe(await page.evaluate(() => platformY(0)));
        });

        test('the chef cannot climb below the plate row', async ({ page }) => {
            const y = await page.evaluate(() => {
                startGame();
                enemies.length = 0;
                setPlayerPos(16, platformY(4));
                setDirection(0, 1);
                for (let i = 0; i < 60; i++) step(0.016);
                return player.y;
            });
            expect(y).toBe(await page.evaluate(() => platformY(4)));
        });

        test('a climb ends standing on the girder below', async ({ page }) => {
            const r = await page.evaluate(() => {
                startGame();
                enemies.length = 0;
                setPlayerPos(16, platformY(3));
                setDirection(0, 1);
                for (let i = 0; i < 200; i++) step(0.016);
                return { y: player.y, plate: platformY(4) };
            });
            expect(r.y).toBe(r.plate);
        });
    });

    // -----------------------------------------------------------------------
    // Ingredients
    // -----------------------------------------------------------------------
    test.describe('ingredients', () => {
        test('walking the full width of an ingredient drops it one level', async ({ page }) => {
            const r = await page.evaluate(() => {
                startGame();
                enemies.length = 0;
                const ing = ingredients.find((i) => i.col === 0 && i.level === 0);
                setPlayerPos(ing.x - 8, platformY(0));
                setDirection(1, 0);
                for (let i = 0; i < 400; i++) { enemies.length = 0; step(0.016); }
                return ing.level;
            });
            expect(r).toBe(1);
        });

        test('a partial walk marks segments but does not drop the ingredient', async ({ page }) => {
            const r = await page.evaluate(() => {
                startGame();
                enemies.length = 0;
                const ing = ingredients.find((i) => i.col === 0 && i.level === 0);
                setPlayerPos(ing.x + 4, platformY(0));
                setDirection(1, 0);
                for (let i = 0; i < 10; i++) { enemies.length = 0; step(0.016); }
                return { level: ing.level, marked: ing.segments.filter(Boolean).length };
            });
            expect(r.level).toBe(0);
            expect(r.marked).toBeGreaterThan(0);
            expect(r.marked).toBeLessThan(4);
        });

        test('dropIngredient lowers the level and clears the trodden segments', async ({ page }) => {
            const r = await page.evaluate(() => {
                startGame();
                const ing = ingredients.find((i) => i.col === 0 && i.level === 0);
                ing.segments[0] = true;
                dropIngredient(ing);
                return { level: ing.level, marked: ing.segments.filter(Boolean).length };
            });
            expect(r.level).toBe(1);
            expect(r.marked).toBe(0);
        });

        test('dropping an ingredient scores points', async ({ page }) => {
            const gain = await page.evaluate(() => {
                startGame();
                const before = score;
                dropIngredient(ingredients.find((i) => i.col === 0 && i.level === 0));
                return score - before;
            });
            expect(gain).toBeGreaterThan(0);
        });

        test('an ingredient landing on another shoves it down as well', async ({ page }) => {
            const r = await page.evaluate(() => {
                startGame();
                const top = ingredients.find((i) => i.col === 0 && i.level === 0);
                const second = ingredients.find((i) => i.col === 0 && i.level === 1);
                dropIngredient(top);
                return { top: top.level, second: second.level };
            });
            expect(r.top).toBe(1);
            expect(r.second).toBe(2);
        });

        test('a cascade shoves the whole stack down one floor', async ({ page }) => {
            const levels = await page.evaluate(() => {
                startGame();
                const col = ingredients.filter((i) => i.col === 1).sort((a, b) => a.level - b.level);
                dropIngredient(col[0]);
                return col.map((i) => i.level);
            });
            expect(levels).toEqual([1, 2, 3, 4]);
        });

        test('an already falling ingredient is not dropped twice', async ({ page }) => {
            const lvl = await page.evaluate(() => {
                startGame();
                const ing = ingredients.find((i) => i.col === 0 && i.level === 0);
                dropIngredient(ing);
                dropIngredient(ing);
                return ing.level;
            });
            expect(lvl).toBe(1);
        });

        test('an ingredient reaching the bottom lands on the plate', async ({ page }) => {
            const r = await page.evaluate(() => {
                startGame();
                enemies.length = 0;
                const ing = ingredients.find((i) => i.col === 0 && i.level === 3);
                dropIngredient(ing);
                for (let i = 0; i < 200; i++) { enemies.length = 0; step(0.016); }
                return { onPlate: ing.onPlate, falling: ing.falling, level: ing.level };
            });
            expect(r.onPlate).toBe(true);
            expect(r.falling).toBe(false);
            expect(r.level).toBe(4);
        });

        test('four ingredients on a plate completes the burger', async ({ page }) => {
            const r = await page.evaluate(() => {
                startGame();
                for (let k = 0; k < 80; k++) {
                    enemies.length = 0;
                    for (const ing of ingredients.filter((i) => i.col === 0)) dropIngredient(ing);
                    step(0.05);
                }
                return { onPlate: ingredientsOnPlate(0), complete: burgerComplete(0) };
            });
            expect(r.onPlate).toBe(4);
            expect(r.complete).toBe(true);
        });

        test('completing a burger awards a bonus', async ({ page }) => {
            const gain = await page.evaluate(() => {
                startGame();
                let before = score;
                for (let k = 0; k < 80; k++) {
                    enemies.length = 0;
                    for (const ing of ingredients.filter((i) => i.col === 0)) dropIngredient(ing);
                    step(0.05);
                }
                return score - before;
            });
            expect(gain).toBeGreaterThanOrEqual(500);
        });
    });

    // -----------------------------------------------------------------------
    // Pepper
    // -----------------------------------------------------------------------
    test.describe('pepper', () => {
        test('spraying spends a pepper and makes a cloud', async ({ page }) => {
            const r = await page.evaluate(() => {
                startGame();
                sprayPepper();
                return { peppers, clouds: pepperClouds.length };
            });
            expect(r.peppers).toBe(4);
            expect(r.clouds).toBe(1);
        });

        test('cannot spray with no peppers left', async ({ page }) => {
            const r = await page.evaluate(() => {
                startGame();
                peppers = 0;
                sprayPepper();
                return { peppers, clouds: pepperClouds.length };
            });
            expect(r.peppers).toBe(0);
            expect(r.clouds).toBe(0);
        });

        test('an enemy caught in the cloud is stunned', async ({ page }) => {
            const stun = await page.evaluate(() => {
                startGame();
                enemies.length = 0;
                player.facing = 1;
                const e = spawnEnemy(player.x + 24, player.y);
                sprayPepper();
                step(0.016);
                return e.stun;
            });
            expect(stun).toBeGreaterThan(0);
        });

        test('a stunned enemy does not move', async ({ page }) => {
            const moved = await page.evaluate(() => {
                startGame();
                enemies.length = 0;
                const e = spawnEnemy(176, platformY(2));
                e.stun = 5;
                const x = e.x, y = e.y;
                for (let i = 0; i < 60; i++) step(0.016);
                return e.x !== x || e.y !== y;
            });
            expect(moved).toBe(false);
        });

        test('a stunned enemy cannot hurt the chef', async ({ page }) => {
            const l = await page.evaluate(() => {
                startGame();
                enemies.length = 0;
                const e = spawnEnemy(player.x, player.y);
                e.stun = 5;
                for (let i = 0; i < 30; i++) step(0.016);
                return lives;
            });
            expect(l).toBe(3);
        });

        test('the stun wears off', async ({ page }) => {
            const stun = await page.evaluate(() => {
                startGame();
                enemies.length = 0;
                const e = spawnEnemy(176, platformY(2));
                e.stun = 0.2;
                for (let i = 0; i < 40; i++) step(0.016);
                return e.stun;
            });
            expect(stun).toBe(0);
        });

        test('peppers refill at the start of a new level', async ({ page }) => {
            const p = await page.evaluate(() => {
                startGame();
                peppers = 0;
                nextLevel();
                return peppers;
            });
            expect(p).toBe(5);
        });
    });

    // -----------------------------------------------------------------------
    // Enemies
    // -----------------------------------------------------------------------
    test.describe('enemies', () => {
        test('enemies move over time', async ({ page }) => {
            const moved = await page.evaluate(() => {
                startGame();
                const e = enemies[0];
                const x = e.x, y = e.y;
                for (let i = 0; i < 120; i++) step(0.016);
                return Math.abs(e.x - x) + Math.abs(e.y - y);
            });
            expect(moved).toBeGreaterThan(0);
        });

        test('enemies stay inside the play field', async ({ page }) => {
            const ok = await page.evaluate(() => {
                startGame();
                for (let i = 0; i < 600; i++) step(0.016);
                return enemies.every((e) => e.x >= 0 && e.x <= CANVAS_W && e.y >= 0 && e.y <= CANVAS_H);
            });
            expect(ok).toBe(true);
        });

        test('touching an enemy costs a life', async ({ page }) => {
            const l = await page.evaluate(() => {
                startGame();
                enemies.length = 0;
                spawnEnemy(player.x, player.y);
                step(0.016);
                return lives;
            });
            expect(l).toBe(2);
        });

        test('losing a life resets the chef to the start position', async ({ page }) => {
            const back = await page.evaluate(() => {
                startGame();
                const start = { x: player.x, y: player.y };
                setPlayerPos(176, platformY(2));
                enemies.length = 0;
                spawnEnemy(player.x, player.y);
                step(0.016);
                return player.x === start.x && player.y === start.y;
            });
            expect(back).toBe(true);
        });

        test('a grace period stops instant repeat deaths', async ({ page }) => {
            const l = await page.evaluate(() => {
                startGame();
                enemies.length = 0;
                spawnEnemy(player.x, player.y);
                step(0.016);
                enemies.length = 0;
                spawnEnemy(player.x, player.y);
                step(0.016);
                return lives;
            });
            expect(l).toBe(2);
        });

        test('running out of lives ends the game', async ({ page }) => {
            const r = await page.evaluate(() => {
                startGame();
                for (let i = 0; i < 5; i++) {
                    enemies.length = 0;
                    spawnEnemy(player.x, player.y);
                    grace = 0;
                    step(0.016);
                }
                return { lives, state };
            });
            expect(r.lives).toBe(0);
            expect(r.state).toBe('over');
        });

        test('game over shows the overlay', async ({ page }) => {
            await page.evaluate(() => {
                startGame();
                for (let i = 0; i < 5; i++) {
                    enemies.length = 0;
                    spawnEnemy(player.x, player.y);
                    grace = 0;
                    step(0.016);
                }
            });
            await expect(page.locator('#overlay')).toHaveClass(/visible/);
            await expect(page.locator('#overlay-title')).toContainText(/game over/i);
        });

        test('a falling ingredient squashes an enemy underneath', async ({ page }) => {
            const r = await page.evaluate(() => {
                startGame();
                enemies.length = 0;
                const ing = ingredients.find((i) => i.col === 0 && i.level === 0);
                const e = spawnEnemy(ing.x + 64, platformY(1));
                const before = score;
                dropIngredient(ing);
                for (let i = 0; i < 120; i++) step(0.016);
                return { squashed: e.squashed, gain: score - before };
            });
            expect(r.squashed).toBe(true);
            expect(r.gain).toBeGreaterThan(0);
        });

        test('a squashed enemy comes back later', async ({ page }) => {
            const back = await page.evaluate(() => {
                startGame();
                enemies.length = 0;
                const e = spawnEnemy(176, platformY(2));
                e.squashed = true;
                e.respawn = 0.2;
                for (let i = 0; i < 40; i++) step(0.016);
                return e.squashed;
            });
            expect(back).toBe(false);
        });

        test('later levels send more enemies', async ({ page }) => {
            const r = await page.evaluate(() => {
                startGame();
                const first = enemies.length;
                nextLevel();
                return { first, second: enemies.length, level };
            });
            expect(r.level).toBe(2);
            expect(r.second).toBeGreaterThan(r.first);
        });
    });

    // -----------------------------------------------------------------------
    // Level progression
    // -----------------------------------------------------------------------
    test.describe('level progression', () => {
        test('completing every burger advances to the next level', async ({ page }) => {
            const r = await page.evaluate(() => {
                startGame();
                for (let k = 0; k < 200 && level === 1; k++) {
                    enemies.length = 0;
                    for (const ing of ingredients) dropIngredient(ing);
                    step(0.05);
                }
                return { level, onPlate: ingredientsOnPlate(0) };
            });
            expect(r.level).toBe(2);
            expect(r.onPlate).toBe(0);
        });

        test('a fresh level rebuilds all four burgers', async ({ page }) => {
            const counts = await page.evaluate(() => {
                startGame();
                nextLevel();
                return [0, 1, 2, 3].map((c) => ingredients.filter((i) => i.col === c && !i.onPlate).length);
            });
            expect(counts).toEqual([4, 4, 4, 4]);
        });

        test('the level bonus is awarded', async ({ page }) => {
            const gain = await page.evaluate(() => {
                startGame();
                const before = score;
                for (let k = 0; k < 200 && level === 1; k++) {
                    enemies.length = 0;
                    for (const ing of ingredients) dropIngredient(ing);
                    step(0.05);
                }
                return score - before;
            });
            expect(gain).toBeGreaterThanOrEqual(1000);
        });
    });

    // -----------------------------------------------------------------------
    // Pause
    // -----------------------------------------------------------------------
    test.describe('pause', () => {
        test('P pauses the game', async ({ page }) => {
            await page.keyboard.press('Space');
            await page.keyboard.press('p');
            expect(await page.evaluate(() => state)).toBe('paused');
            await expect(page.locator('#overlay-title')).toContainText(/paused/i);
        });

        test('nothing moves while paused', async ({ page }) => {
            const moved = await page.evaluate(() => {
                startGame();
                togglePause();
                const x = player.x;
                setDirection(1, 0);
                for (let i = 0; i < 30; i++) step(0.016);
                return player.x !== x;
            });
            expect(moved).toBe(false);
        });

        test('P resumes the game', async ({ page }) => {
            await page.keyboard.press('Space');
            await page.keyboard.press('p');
            await page.keyboard.press('p');
            expect(await page.evaluate(() => state)).toBe('running');
        });
    });

    // -----------------------------------------------------------------------
    // HUD & persistence
    // -----------------------------------------------------------------------
    test.describe('HUD', () => {
        test('the HUD tracks score, lives and peppers', async ({ page }) => {
            await page.evaluate(() => {
                startGame();
                dropIngredient(ingredients.find((i) => i.col === 0 && i.level === 0));
                sprayPepper();
                step(0.016);
            });
            await expect(page.locator('#peppers')).toHaveText('4');
            await expect(page.locator('#score')).not.toHaveText('0');
        });

        test('the best score is stored on game over', async ({ page }) => {
            const best = await page.evaluate(() => {
                startGame();
                score = 1234;
                endGame();
                return window.localStorage.getItem('burgertime-best');
            });
            expect(best).toBe('1234');
        });

        test('Space restarts after a game over', async ({ page }) => {
            await page.evaluate(() => { startGame(); endGame(); });
            await page.keyboard.press('Space');
            expect(await page.evaluate(() => state)).toBe('running');
        });
    });

    // -----------------------------------------------------------------------
    // Keyboard wiring
    // -----------------------------------------------------------------------
    test.describe('keyboard', () => {
        test('arrow keys steer the chef', async ({ page }) => {
            await page.keyboard.press('Space');
            await page.evaluate(() => { enemies.length = 0; setPlayerPos(336, platformY(4)); });
            await page.keyboard.down('ArrowRight');
            const dir = await page.evaluate(() => ({ dx: player.dx, dy: player.dy }));
            await page.keyboard.up('ArrowRight');
            expect(dir.dx).toBe(1);
            expect(dir.dy).toBe(0);
        });

        test('releasing the key stops the chef', async ({ page }) => {
            await page.keyboard.press('Space');
            await page.keyboard.down('ArrowRight');
            await page.keyboard.up('ArrowRight');
            const dir = await page.evaluate(() => ({ dx: player.dx, dy: player.dy }));
            expect(dir.dx).toBe(0);
        });

        test('Space sprays pepper while playing', async ({ page }) => {
            await page.keyboard.press('Space');
            await page.keyboard.press('Space');
            expect(await page.evaluate(() => peppers)).toBe(4);
        });
    });
});
