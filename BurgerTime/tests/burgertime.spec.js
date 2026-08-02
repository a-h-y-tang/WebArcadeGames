const { test, expect } = require('@playwright/test');
const path = require('path');
const { pathToFileURL } = require('url');

const GAME_URL = pathToFileURL(path.resolve(__dirname, '../index.html')).href;

// Most gameplay tests want a running game with a quiet board: no enemies
// present and none about to spawn, so chef and ingredient behaviour can be
// asserted without random interference. `quiet()` is spliced into the page
// function body of `page.evaluate` by the helper below.
const QUIET = 'startGame(); enemies.length = 0; spawnTimer = 9999;';

// Run `body` (a JS statement list, returning a value) inside the page with the
// quiet-board preamble in front of it.
function inGame(page, body) {
    return page.evaluate(`(() => {\n${QUIET}\n${body}\n})()`);
}

// Walk the chef left-to-right across burger column `col` on floor `level`,
// then let anything it knocked loose finish falling.
const WALK = (col, level) => `
    placeChef(COL_X[${col}] - ING_W / 2 - 4, ${level});
    chefInput.x = 1;
    for (let i = 0; i < 70; i++) step(1 / 60);
    chefInput.x = 0;
    for (let i = 0; i < 300; i++) step(1 / 60);
`;

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

        test('score, level, lives and best are shown', async ({ page }) => {
            await expect(page.locator('#score')).toHaveText('0');
            await expect(page.locator('#level')).toHaveText('1');
            await expect(page.locator('#lives')).toHaveText('3');
            await expect(page.locator('#best')).toHaveText('0');
        });

        test('canvas is 600x600', async ({ page }) => {
            const canvas = page.locator('#canvas');
            await expect(canvas).toHaveAttribute('width', '600');
            await expect(canvas).toHaveAttribute('height', '600');
        });

        test('state is idle before starting', async ({ page }) => {
            expect(await page.evaluate(() => state)).toBe('idle');
        });

        test('board holds 16 ingredients — four per burger column', async ({ page }) => {
            const counts = await page.evaluate(() => ({
                total: ingredients.length,
                per: COL_X.map((_, c) => ingredients.filter((i) => i.col === c).length),
            }));
            expect(counts.total).toBe(16);
            expect(counts.per).toEqual([4, 4, 4, 4]);
        });

        test('each column starts stacked bun-top / lettuce / patty / bun-bottom', async ({ page }) => {
            const kinds = await page.evaluate(() =>
                [0, 1, 2, 3].map((l) => piles[0][l].map((i) => i.kind)));
            expect(kinds).toEqual([['bun-top'], ['lettuce'], ['patty'], ['bun-bottom']]);
        });

        test('no ingredients sit on the plates yet', async ({ page }) => {
            const onPlates = await page.evaluate(() =>
                COL_X.map((_, c) => piles[c][PLATE_LEVEL].length));
            expect(onPlates).toEqual([0, 0, 0, 0]);
        });

        test('best score loads from localStorage', async ({ page }) => {
            await page.evaluate(() => window.localStorage.setItem('burgertime-best', '4200'));
            await page.reload();
            await expect(page.locator('#best')).toHaveText('4200');
        });
    });

    // -----------------------------------------------------------------------
    // Starting / pausing
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

        test('the chef starts on the bottom floor with a full pepper supply', async ({ page }) => {
            const s = await page.evaluate(() => {
                startGame();
                return { floor: chef.floor, y: chef.y, bottom: LEVEL_Y[4], peppers, lives, level };
            });
            expect(s.floor).toBe(4);
            expect(s.y).toBe(s.bottom);
            expect(s.peppers).toBe(5);
            expect(s.lives).toBe(3);
            expect(s.level).toBe(1);
        });

        test('P pauses and resumes', async ({ page }) => {
            await page.keyboard.press('Space');
            await page.keyboard.press('p');
            expect(await page.evaluate(() => state)).toBe('paused');
            await page.keyboard.press('p');
            expect(await page.evaluate(() => state)).toBe('running');
        });

        test('nothing moves while paused', async ({ page }) => {
            const x = await inGame(page, `
                placeChef(300, 4);
                togglePause();
                chefInput.x = 1;
                for (let i = 0; i < 30; i++) step(1 / 60);
                return chef.x;
            `);
            expect(x).toBe(300);
        });
    });

    // -----------------------------------------------------------------------
    // Chef movement
    // -----------------------------------------------------------------------
    test.describe('chef movement', () => {
        test('walks right along a floor', async ({ page }) => {
            const s = await inGame(page, `
                placeChef(300, 4);
                chefInput.x = 1;
                for (let i = 0; i < 30; i++) step(1 / 60);
                return { x: chef.x, floor: chef.floor };
            `);
            expect(s.x).toBeGreaterThan(300);
            expect(s.floor).toBe(4);
        });

        test('walks left along a floor', async ({ page }) => {
            const x = await inGame(page, `
                placeChef(300, 4);
                chefInput.x = -1;
                for (let i = 0; i < 30; i++) step(1 / 60);
                return chef.x;
            `);
            expect(x).toBeLessThan(300);
        });

        test('cannot walk off the left or right edge', async ({ page }) => {
            const s = await inGame(page, `
                placeChef(300, 4);
                chefInput.x = -1;
                for (let i = 0; i < 400; i++) step(1 / 60);
                const left = chef.x;
                chefInput.x = 1;
                for (let i = 0; i < 600; i++) step(1 / 60);
                return { left, right: chef.x, lo: FLOOR_X0, hi: FLOOR_X1 };
            `);
            expect(s.left).toBeGreaterThanOrEqual(s.lo);
            expect(s.right).toBeLessThanOrEqual(s.hi);
        });

        test('climbs a ladder upwards', async ({ page }) => {
            const s = await inGame(page, `
                placeChef(300, 4);
                chefInput.y = -1;
                for (let i = 0; i < 60; i++) step(1 / 60);
                return { y: chef.y, floor: chef.floor, third: LEVEL_Y[3] };
            `);
            expect(s.y).toBeLessThan(s.third);
            expect(s.floor).toBeLessThanOrEqual(3);
        });

        test('mounting a ladder snaps the chef to the ladder centre', async ({ page }) => {
            const x = await inGame(page, `
                placeChef(308, 4);
                chefInput.y = -1;
                step(1 / 60);
                return chef.x;
            `);
            expect(x).toBe(300);
        });

        test('cannot climb where there is no ladder', async ({ page }) => {
            const s = await inGame(page, `
                placeChef(90, 4);
                chefInput.y = -1;
                for (let i = 0; i < 60; i++) step(1 / 60);
                return { y: chef.y, bottom: LEVEL_Y[4] };
            `);
            expect(s.y).toBe(s.bottom);
        });

        test('cannot climb below the bottom floor', async ({ page }) => {
            const s = await inGame(page, `
                placeChef(300, 4);
                chefInput.y = 1;
                for (let i = 0; i < 60; i++) step(1 / 60);
                return { y: chef.y, bottom: LEVEL_Y[4] };
            `);
            expect(s.y).toBe(s.bottom);
        });

        test('a ladder with a missing rung cannot be used', async ({ page }) => {
            // The x=160 ladder deliberately skips the gap between floors 2 and 3.
            const s = await inGame(page, `
                placeChef(160, 2);
                chefInput.y = 1;
                for (let i = 0; i < 60; i++) step(1 / 60);
                return { y: chef.y, floorY: LEVEL_Y[2] };
            `);
            expect(s.y).toBe(s.floorY);
        });

        test('stepping off a ladder at a floor allows horizontal movement again', async ({ page }) => {
            const s = await inGame(page, `
                placeChef(300, 4);
                chefInput.y = -1;
                while (chef.y > LEVEL_Y[3]) step(1 / 60);
                chefInput.y = 0;
                chefInput.x = 1;
                for (let i = 0; i < 20; i++) step(1 / 60);
                return { x: chef.x, floor: chef.floor };
            `);
            expect(s.x).toBeGreaterThan(300);
            expect(s.floor).toBe(3);
        });
    });

    // -----------------------------------------------------------------------
    // Ingredients
    // -----------------------------------------------------------------------
    test.describe('ingredients', () => {
        test('walking over part of an ingredient presses only that segment', async ({ page }) => {
            const segs = await inGame(page, `
                placeChef(COL_X[0] - ING_W / 2 + SEG_W / 2, 0);
                step(1 / 60);
                return piles[0][0][0].segments.slice();
            `);
            expect(segs).toEqual([true, false, false, false]);
        });

        test('an ingredient with un-pressed segments does not fall', async ({ page }) => {
            const s = await inGame(page, `
                placeChef(COL_X[0] - ING_W / 2 + SEG_W / 2, 0);
                for (let i = 0; i < 30; i++) step(1 / 60);
                return { onTop: piles[0][0].length, falling: fallingGroups.length };
            `);
            expect(s.onTop).toBe(1);
            expect(s.falling).toBe(0);
        });

        test('walking the full width of an ingredient drops it', async ({ page }) => {
            const s = await inGame(page, `
                placeChef(COL_X[0] - ING_W / 2 - 4, 0);
                chefInput.x = 1;
                for (let i = 0; i < 70; i++) step(1 / 60);
                return { onTop: piles[0][0].length, dropped: fallingGroups.length > 0 };
            `);
            expect(s.onTop).toBe(0);
            expect(s.dropped).toBe(true);
        });

        test('a dropped ingredient cascades the whole column onto the bottom floor', async ({ page }) => {
            const s = await inGame(page, `
                ${WALK(0, 0)}
                return {
                    bottom: piles[0][4].map((i) => i.kind),
                    upper: [0, 1, 2, 3].map((l) => piles[0][l].length),
                    plate: piles[0][PLATE_LEVEL].length,
                    falling: fallingGroups.length,
                };
            `);
            expect(s.falling).toBe(0);
            expect(s.bottom).toEqual(['bun-bottom', 'patty', 'lettuce', 'bun-top']);
            expect(s.upper).toEqual([0, 0, 0, 0]);   // every upper floor emptied
            expect(s.plate).toBe(0);                 // but not yet on the plate
        });

        test('dropping a pile scores 50 per ingredient', async ({ page }) => {
            const s = await inGame(page, `${WALK(0, 0)} return score;`);
            expect(s).toBe(200);
        });

        test('a second pass over the stack lands the burger on its plate', async ({ page }) => {
            const s = await inGame(page, `
                ${WALK(0, 0)}
                ${WALK(0, 4)}
                return {
                    plate: piles[0][PLATE_LEVEL].map((i) => i.kind),
                    complete: columnComplete(0),
                    others: [1, 2, 3].map((c) => columnComplete(c)),
                };
            `);
            expect(s.plate).toEqual(['bun-bottom', 'patty', 'lettuce', 'bun-top']);
            expect(s.complete).toBe(true);
            expect(s.others).toEqual([false, false, false]);
        });

        test('only the top ingredient of a pile can be pressed', async ({ page }) => {
            const s = await inGame(page, `
                ${WALK(0, 0)}
                placeChef(COL_X[0] - ING_W / 2 + SEG_W / 2, 4);
                step(1 / 60);
                return piles[0][4].map((i) => i.segments[0]);
            `);
            expect(s).toEqual([false, false, false, true]);
        });

        test('resting ingredients stack visibly on top of each other', async ({ page }) => {
            const ys = await inGame(page, `${WALK(0, 0)} return piles[0][4].map((i) => i.y);`);
            for (let i = 1; i < ys.length; i++) expect(ys[i]).toBeLessThan(ys[i - 1]);
        });

        test('a falling ingredient resets its pressed segments', async ({ page }) => {
            const segs = await inGame(page, `${WALK(0, 0)} return piles[0][4].flatMap((i) => i.segments);`);
            expect(segs.some(Boolean)).toBe(false);
        });

        test('dropping one column leaves the others untouched', async ({ page }) => {
            const s = await inGame(page, `${WALK(0, 0)} return [1, 2, 3].map((c) => piles[c][0].length);`);
            expect(s).toEqual([1, 1, 1]);
        });
    });

    // -----------------------------------------------------------------------
    // Enemies and lives
    // -----------------------------------------------------------------------
    test.describe('enemies', () => {
        test('enemies spawn over time while playing', async ({ page }) => {
            const n = await page.evaluate(() => {
                startGame();
                enemies.length = 0;
                for (let i = 0; i < 600; i++) step(1 / 60);
                return enemies.length;
            });
            expect(n).toBeGreaterThan(0);
        });

        test('an enemy walks toward the chef', async ({ page }) => {
            const s = await inGame(page, `
                placeChef(560, 0);
                const e = spawnEnemy(60, 0);
                const before = e.x;
                for (let i = 0; i < 60; i++) step(1 / 60);
                return { before, after: e.x };
            `);
            expect(s.after).toBeGreaterThan(s.before);
        });

        test('an enemy climbs toward the chef on another floor', async ({ page }) => {
            const s = await inGame(page, `
                placeChef(20, 4);
                const e = spawnEnemy(20, 0);
                for (let i = 0; i < 240; i++) step(1 / 60);
                return { y: e.y, top: LEVEL_Y[0] };
            `);
            expect(s.y).toBeGreaterThan(s.top);
        });

        test('touching an enemy costs a life and clears the board of enemies', async ({ page }) => {
            const s = await inGame(page, `
                placeChef(300, 4);
                spawnEnemy(304, 4);
                step(1 / 60);
                return { lives, floor: chef.floor, enemies: enemies.length };
            `);
            expect(s.lives).toBe(2);
            expect(s.floor).toBe(4);
            expect(s.enemies).toBe(0);
        });

        test('losing the last life ends the game', async ({ page }) => {
            const s = await inGame(page, `
                lives = 1;
                placeChef(300, 4);
                spawnEnemy(304, 4);
                step(1 / 60);
                return state;
            `);
            expect(s).toBe('over');
        });

        test('ingredient progress survives losing a life', async ({ page }) => {
            const s = await inGame(page, `
                ${WALK(0, 0)}
                placeChef(300, 4);
                spawnEnemy(304, 4);
                step(1 / 60);
                return { lives, bottom: piles[0][4].length };
            `);
            expect(s.lives).toBe(2);
            expect(s.bottom).toBe(4);
        });
    });

    // -----------------------------------------------------------------------
    // Pepper
    // -----------------------------------------------------------------------
    test.describe('pepper', () => {
        test('firing pepper stuns a nearby enemy and uses a shaker', async ({ page }) => {
            const s = await inGame(page, `
                placeChef(300, 4);
                chef.facing = 1;
                const e = spawnEnemy(330, 4);
                firePepper();
                return { stun: e.stun, peppers };
            `);
            expect(s.stun).toBeGreaterThan(0);
            expect(s.peppers).toBe(4);
        });

        test('pepper does not reach enemies behind the chef', async ({ page }) => {
            const stun = await inGame(page, `
                placeChef(300, 4);
                chef.facing = 1;
                const e = spawnEnemy(250, 4);
                firePepper();
                return e.stun;
            `);
            expect(stun).toBe(0);
        });

        test('a stunned enemy stops moving and is harmless', async ({ page }) => {
            const s = await inGame(page, `
                placeChef(300, 4);
                chef.facing = 1;
                const e = spawnEnemy(310, 4);
                firePepper();
                const before = e.x;
                for (let i = 0; i < 30; i++) step(1 / 60);
                return { moved: Math.abs(e.x - before), lives };
            `);
            expect(s.moved).toBe(0);
            expect(s.lives).toBe(3);
        });

        test('a stun wears off', async ({ page }) => {
            const s = await inGame(page, `
                placeChef(300, 4);
                chef.facing = 1;
                const e = spawnEnemy(330, 4);
                firePepper();
                const stunned = e.stun;
                for (let i = 0; i < 60 * 8; i++) step(1 / 60);
                return { stunned, after: e.stun };
            `);
            expect(s.stunned).toBeGreaterThan(0);
            expect(s.after).toBeLessThanOrEqual(0);
        });

        test('pepper cannot be fired with an empty shaker', async ({ page }) => {
            const s = await inGame(page, `
                peppers = 0;
                placeChef(300, 4);
                const e = spawnEnemy(320, 4);
                const fired = firePepper();
                return { fired, stun: e.stun, peppers };
            `);
            expect(s.fired).toBe(false);
            expect(s.stun).toBe(0);
            expect(s.peppers).toBe(0);
        });
    });

    // -----------------------------------------------------------------------
    // Squashing
    // -----------------------------------------------------------------------
    test.describe('squashing', () => {
        test('an enemy caught under a dropping pile is squashed for 500 points', async ({ page }) => {
            const s = await inGame(page, `
                const e = spawnEnemy(COL_X[0], 0);
                e.stun = 99; // hold it still on the ingredient
                ${WALK(0, 0)}
                return { alive: e.alive, score, enemies: enemies.length };
            `);
            expect(s.alive).toBe(false);
            expect(s.score).toBe(700); // 4 x 50 for the burger + 500 for the squash
            expect(s.enemies).toBe(0);
        });

        test('an enemy on another column is not squashed', async ({ page }) => {
            const alive = await inGame(page, `
                const e = spawnEnemy(COL_X[1], 0);
                e.stun = 99;
                ${WALK(0, 0)}
                return e.alive;
            `);
            expect(alive).toBe(true);
        });
    });

    // -----------------------------------------------------------------------
    // Level progression
    // -----------------------------------------------------------------------
    test.describe('levels', () => {
        const CLEAR_BOARD = `
            COL_X.forEach((_, c) => {
                for (let l = 0; l <= PLATE_LEVEL; l++) piles[c][l] = [];
                piles[c][PLATE_LEVEL] = ingredients.filter((i) => i.col === c);
            });
            restack();
            step(1 / 60);
        `;

        test('completing every burger advances to the next level', async ({ page }) => {
            const s = await inGame(page, `
                ${CLEAR_BOARD}
                return { level, score, peppers, onPlate: piles[0][PLATE_LEVEL].length };
            `);
            expect(s.level).toBe(2);
            expect(s.score).toBe(1000);
            expect(s.peppers).toBe(5);
            expect(s.onPlate).toBe(0); // board rebuilt for the new level
        });

        test('the level counter is shown in the HUD', async ({ page }) => {
            await inGame(page, CLEAR_BOARD);
            await expect(page.locator('#level')).toHaveText('2');
        });

        test('enemies get faster on later levels', async ({ page }) => {
            const s = await page.evaluate(() => {
                startGame();
                const a = enemySpeed();
                level = 4;
                return { a, b: enemySpeed() };
            });
            expect(s.b).toBeGreaterThan(s.a);
        });
    });

    // -----------------------------------------------------------------------
    // Game over
    // -----------------------------------------------------------------------
    test.describe('game over', () => {
        const DIE = `
            lives = 1;
            placeChef(300, 4);
            spawnEnemy(304, 4);
            step(1 / 60);
        `;

        test('the overlay reappears with a game-over message', async ({ page }) => {
            await inGame(page, DIE);
            await expect(page.locator('#overlay')).toHaveClass(/visible/);
            await expect(page.locator('#overlay-title')).toContainText(/over/i);
        });

        test('the best score is stored in localStorage', async ({ page }) => {
            const best = await inGame(page, `
                score = 1234;
                ${DIE}
                return window.localStorage.getItem('burgertime-best');
            `);
            expect(best).toBe('1234');
        });

        test('Space restarts after a game over', async ({ page }) => {
            await inGame(page, DIE);
            await page.keyboard.press('Space');
            const s = await page.evaluate(() => ({ state, lives, score }));
            expect(s.state).toBe('running');
            expect(s.lives).toBe(3);
            expect(s.score).toBe(0);
        });
    });
});
