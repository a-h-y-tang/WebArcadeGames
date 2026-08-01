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

        test('canvas is 640x480', async ({ page }) => {
            const canvas = page.locator('#canvas');
            await expect(canvas).toHaveAttribute('width', '640');
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
        test('floors are ordered top to bottom', async ({ page }) => {
            const ys = await page.evaluate(() => FLOOR_ROWS.map((_, i) => floorY(i)));
            for (let i = 1; i < ys.length; i++) expect(ys[i]).toBeGreaterThan(ys[i - 1]);
        });

        test('every ladder column sits inside the canvas', async ({ page }) => {
            const ok = await page.evaluate(() =>
                LADDER_COLS.every((_, i) => ladderX(i) >= 0 && ladderX(i) <= CANVAS_W));
            expect(ok).toBe(true);
        });

        test('there is one burger piece per stack per burger floor', async ({ page }) => {
            const info = await page.evaluate(() => ({
                total: pieces.length,
                stacks: STACK_COLS.length,
                perStack: PIECE_TYPES.length,
            }));
            expect(info.total).toBe(info.stacks * info.perStack);
        });

        test('all pieces start resting with no segments stepped on', async ({ page }) => {
            const clean = await page.evaluate(() =>
                pieces.every((p) => p.state === 'rest' && p.segs.every((s) => s === false)));
            expect(clean).toBe(true);
        });

        test('a piece is four segments wide', async ({ page }) => {
            const info = await page.evaluate(() => ({ segs: pieces[0].segs.length, w: PIECE_W, tile: TILE }));
            expect(info.segs).toBe(4);
            expect(info.w).toBe(4 * info.tile);
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
                enemies.length = 0;
                return { level, lives, pepper, score };
            });
            expect(s.level).toBe(1);
            expect(s.lives).toBe(3);
            expect(s.pepper).toBe(5);
            expect(s.score).toBe(0);
        });

        test('the chef spawns standing on a floor inside the canvas', async ({ page }) => {
            const ok = await page.evaluate(() => {
                startGame();
                enemies.length = 0;
                const onFloor = FLOOR_ROWS.some((_, i) => Math.abs(floorY(i) - chef.y) < 1);
                return onFloor && chef.x > 0 && chef.x < CANVAS_W;
            });
            expect(ok).toBe(true);
        });

        test('at least two enemies are on the board', async ({ page }) => {
            const n = await page.evaluate(() => { startGame(); return enemies.length; });
            expect(n).toBeGreaterThanOrEqual(2);
        });
    });

    // -----------------------------------------------------------------------
    // Chef movement
    // -----------------------------------------------------------------------
    test.describe('chef movement', () => {
        test('moving right increases the chef x', async ({ page }) => {
            const { before, after } = await page.evaluate(() => {
                startGame();
                enemies.length = 0;
                placeChef(300, floorY(4));
                const before = chef.x;
                moveChef(1, 0);
                for (let i = 0; i < 20; i++) step(0.016);
                return { before, after: chef.x };
            });
            expect(after).toBeGreaterThan(before);
        });

        test('moving left decreases the chef x', async ({ page }) => {
            const { before, after } = await page.evaluate(() => {
                startGame();
                enemies.length = 0;
                placeChef(300, floorY(4));
                const before = chef.x;
                moveChef(-1, 0);
                for (let i = 0; i < 20; i++) step(0.016);
                return { before, after: chef.x };
            });
            expect(after).toBeLessThan(before);
        });

        test('the chef cannot walk off either edge', async ({ page }) => {
            const { left, right } = await page.evaluate(() => {
                startGame();
                enemies.length = 0;
                placeChef(300, floorY(4));
                moveChef(-1, 0);
                for (let i = 0; i < 600; i++) step(0.016);
                const left = chef.x;
                moveChef(1, 0);
                for (let i = 0; i < 900; i++) step(0.016);
                return { left, right: chef.x };
            });
            expect(left).toBeGreaterThanOrEqual(0);
            expect(right).toBeLessThanOrEqual(640);
        });

        test('the chef cannot climb where there is no ladder', async ({ page }) => {
            const { before, after } = await page.evaluate(() => {
                startGame();
                enemies.length = 0;
                // a spot deliberately away from every ladder column
                const x = (ladderX(1) + ladderX(2)) / 2;
                placeChef(x, floorY(3));
                const before = chef.y;
                moveChef(0, -1);
                for (let i = 0; i < 40; i++) step(0.016);
                return { before, after: chef.y };
            });
            expect(after).toBe(before);
        });

        test('the chef climbs up a ladder', async ({ page }) => {
            const { before, after } = await page.evaluate(() => {
                startGame();
                enemies.length = 0;
                placeChef(ladderX(1), floorY(3));
                const before = chef.y;
                moveChef(0, -1);
                for (let i = 0; i < 40; i++) step(0.016);
                return { before, after: chef.y };
            });
            expect(after).toBeLessThan(before);
        });

        test('climbing snaps the chef to the ladder centre', async ({ page }) => {
            const x = await page.evaluate(() => {
                startGame();
                enemies.length = 0;
                placeChef(ladderX(1) + 4, floorY(3));
                moveChef(0, -1);
                for (let i = 0; i < 10; i++) step(0.016);
                return chef.x;
            });
            const expected = await page.evaluate(() => ladderX(1));
            expect(x).toBeCloseTo(expected, 5);
        });

        test('the chef cannot climb above the top floor', async ({ page }) => {
            const { y, top } = await page.evaluate(() => {
                startGame();
                enemies.length = 0;
                placeChef(ladderX(1), floorY(1));
                moveChef(0, -1);
                for (let i = 0; i < 400; i++) step(0.016);
                return { y: chef.y, top: floorY(0) };
            });
            expect(y).toBeGreaterThanOrEqual(top);
        });

        test('the chef cannot climb below the plate floor', async ({ page }) => {
            const { y, bottom } = await page.evaluate(() => {
                startGame();
                enemies.length = 0;
                placeChef(ladderX(1), floorY(3));
                moveChef(0, 1);
                for (let i = 0; i < 400; i++) step(0.016);
                return { y: chef.y, bottom: floorY(FLOOR_ROWS.length - 1) };
            });
            expect(y).toBeLessThanOrEqual(bottom);
        });

        test('the chef cannot walk sideways in mid-ladder', async ({ page }) => {
            const { before, after } = await page.evaluate(() => {
                startGame();
                enemies.length = 0;
                placeChef(ladderX(1), floorY(3));
                moveChef(0, -1);
                for (let i = 0; i < 10; i++) step(0.016); // climb off the floor line
                const before = chef.x;
                moveChef(1, 0);
                for (let i = 0; i < 20; i++) step(0.016);
                return { before, after: chef.x };
            });
            expect(after).toBe(before);
        });
    });

    // -----------------------------------------------------------------------
    // Walking on ingredients
    // -----------------------------------------------------------------------
    test.describe('stepping on ingredients', () => {
        test('walking the full width of a piece drops it', async ({ page }) => {
            const state = await page.evaluate(() => {
                startGame();
                enemies.length = 0;
                const p = pieceAt(0, 0);
                placeChef(pieceLeft(p) - 16, floorY(p.floor));
                moveChef(1, 0);
                for (let i = 0; i < 300 && p.state === 'rest'; i++) step(0.016);
                return p.state;
            });
            expect(state).not.toBe('rest');
        });

        test('walking over part of a piece only marks those segments', async ({ page }) => {
            const segs = await page.evaluate(() => {
                startGame();
                enemies.length = 0;
                const p = pieceAt(0, 0);
                placeChef(pieceLeft(p) - 16, floorY(p.floor));
                moveChef(1, 0);
                // stop after roughly two segments
                for (let i = 0; i < 300 && chef.x < pieceLeft(p) + 2 * TILE + 4; i++) step(0.016);
                moveChef(0, 0);
                return p.segs.slice();
            });
            expect(segs[0]).toBe(true);
            expect(segs[1]).toBe(true);
            expect(segs[3]).toBe(false);
        });

        test('walking underneath a piece does not step on it', async ({ page }) => {
            const segs = await page.evaluate(() => {
                startGame();
                enemies.length = 0;
                const p = pieceAt(0, 0);
                placeChef(pieceLeft(p) - 16, floorY(p.floor + 1));
                moveChef(1, 0);
                for (let i = 0; i < 300; i++) step(0.016);
                return p.segs.slice();
            });
            expect(segs.every((s) => s === false)).toBe(true);
        });

        test('dropping a piece scores points', async ({ page }) => {
            const gained = await page.evaluate(() => {
                startGame();
                enemies.length = 0;
                score = 0;
                const p = pieceAt(0, 0);
                dropPiece(p);
                return score;
            });
            expect(gained).toBe(await page.evaluate(() => DROP_POINTS));
        });
    });

    // -----------------------------------------------------------------------
    // Falling, chaining and plating
    // -----------------------------------------------------------------------
    test.describe('falling ingredients', () => {
        test('a dropped piece falls downward', async ({ page }) => {
            const { before, after } = await page.evaluate(() => {
                startGame();
                enemies.length = 0;
                const p = pieceAt(0, 0);
                dropPiece(p);
                const before = p.y;
                step(0.05);
                return { before, after: p.y };
            });
            expect(after).toBeGreaterThan(before);
        });

        test('a piece landing on another knocks it loose too', async ({ page }) => {
            const both = await page.evaluate(() => {
                startGame();
                enemies.length = 0;
                const top = pieceAt(0, 0);
                const next = pieceAt(0, 1);
                dropPiece(top);
                for (let i = 0; i < 40 && next.state === 'rest'; i++) step(0.016);
                return next.state;
            });
            expect(both).not.toBe('rest');
        });

        test('a piece rests on the next floor when nothing is there', async ({ page }) => {
            const result = await page.evaluate(() => {
                startGame();
                enemies.length = 0;
                const bottom = pieceAt(0, 3);   // clear floor 3 of this stack first
                dropPiece(bottom);
                for (let i = 0; i < 200 && bottom.state !== 'plate'; i++) step(0.016);
                const above = pieceAt(0, 2);
                dropPiece(above);
                for (let i = 0; i < 200 && above.state === 'fall'; i++) step(0.016);
                return { state: above.state, floor: above.floor, y: above.y, expected: floorY(3) };
            });
            expect(result.state).toBe('rest');
            expect(result.floor).toBe(3);
            expect(result.y).toBeCloseTo(result.expected, 5);
        });

        test('a piece that reaches the bottom is plated', async ({ page }) => {
            const s = await page.evaluate(() => {
                startGame();
                enemies.length = 0;
                const p = pieceAt(0, 3);
                dropPiece(p);
                for (let i = 0; i < 200 && p.state !== 'plate'; i++) step(0.016);
                return p.state;
            });
            expect(s).toBe('plate');
        });

        test('a resting piece has its stepped segments cleared', async ({ page }) => {
            const clean = await page.evaluate(() => {
                startGame();
                enemies.length = 0;
                const bottom = pieceAt(0, 3);
                dropPiece(bottom);
                for (let i = 0; i < 200 && bottom.state !== 'plate'; i++) step(0.016);
                const above = pieceAt(0, 2);
                above.segs = [true, true, true, true];
                dropPiece(above);
                for (let i = 0; i < 200 && above.state === 'fall'; i++) step(0.016);
                return above.segs.every((s) => s === false);
            });
            expect(clean).toBe(true);
        });
    });

    // -----------------------------------------------------------------------
    // Pepper
    // -----------------------------------------------------------------------
    test.describe('pepper', () => {
        test('spraying uses one pepper', async ({ page }) => {
            const p = await page.evaluate(() => {
                startGame();
                enemies.length = 0;
                const before = pepper;
                sprayPepper();
                return { before, after: pepper };
            });
            expect(p.after).toBe(p.before - 1);
        });

        test('spraying with no pepper left does nothing', async ({ page }) => {
            const clouds = await page.evaluate(() => {
                startGame();
                enemies.length = 0;
                pepper = 0;
                sprayPepper();
                return { pepper, clouds: peppers.length };
            });
            expect(clouds.pepper).toBe(0);
            expect(clouds.clouds).toBe(0);
        });

        test('pepper stuns an enemy in front of the chef', async ({ page }) => {
            const s = await page.evaluate(() => {
                startGame();
                enemies.length = 0;
                placeChef(300, floorY(4));
                moveChef(1, 0);
                const e = spawnEnemy(340, floorY(4));
                sprayPepper();
                step(0.016);
                return e.state;
            });
            expect(s).toBe('stunned');
        });

        test('pepper does not reach behind the chef', async ({ page }) => {
            const s = await page.evaluate(() => {
                startGame();
                enemies.length = 0;
                placeChef(300, floorY(4));
                moveChef(1, 0);
                const e = spawnEnemy(220, floorY(4));
                sprayPepper();
                step(0.016);
                return e.state;
            });
            expect(s).toBe('chase');
        });

        test('a stunned enemy stays put and is harmless', async ({ page }) => {
            const r = await page.evaluate(() => {
                startGame();
                enemies.length = 0;
                placeChef(300, floorY(4));
                moveChef(1, 0);
                const e = spawnEnemy(340, floorY(4));
                sprayPepper();
                step(0.016);
                const x0 = e.x;
                moveChef(0, 0);
                placeChef(340, floorY(4)); // stand right on top of it
                for (let i = 0; i < 30; i++) step(0.016);
                return { moved: Math.abs(e.x - x0), lives };
            });
            expect(r.moved).toBeLessThan(0.001);
            expect(r.lives).toBe(3);
        });

        test('the stun wears off', async ({ page }) => {
            const s = await page.evaluate(() => {
                startGame();
                enemies.length = 0;
                placeChef(300, floorY(4));
                moveChef(1, 0);
                const e = spawnEnemy(340, floorY(4));
                sprayPepper();
                step(0.016);
                moveChef(0, 0);
                placeChef(40, floorY(0)); // get far out of the way
                for (let i = 0; i < 60 * (STUN_TIME + 1) && e.state === 'stunned'; i++) step(0.016);
                return e.state;
            });
            expect(s).toBe('chase');
        });
    });

    // -----------------------------------------------------------------------
    // Enemies
    // -----------------------------------------------------------------------
    test.describe('enemies', () => {
        test('an enemy on the chef floor walks toward the chef', async ({ page }) => {
            const { before, after } = await page.evaluate(() => {
                startGame();
                enemies.length = 0;
                placeChef(100, floorY(4));
                const e = spawnEnemy(500, floorY(4));
                const before = e.x;
                for (let i = 0; i < 30; i++) step(0.016);
                return { before, after: e.x };
            });
            expect(after).toBeLessThan(before);
        });

        test('an enemy above the chef climbs down a ladder', async ({ page }) => {
            const { before, after } = await page.evaluate(() => {
                startGame();
                enemies.length = 0;
                placeChef(ladderX(1), floorY(4));
                const e = spawnEnemy(ladderX(1), floorY(2));
                const before = e.y;
                for (let i = 0; i < 30; i++) step(0.016);
                return { before, after: e.y };
            });
            expect(after).toBeGreaterThan(before);
        });

        test('an enemy with no ladder to hand heads for one', async ({ page }) => {
            const r = await page.evaluate(() => {
                startGame();
                enemies.length = 0;
                // Chef one floor up, and no ladder between the two of them —
                // parking underneath would leave the enemy stuck forever.
                placeChef(300, floorY(0));
                const e = spawnEnemy(250, floorY(1));
                const before = e.x;
                for (let i = 0; i < 60; i++) step(0.016);
                return { before, after: e.x, ladder: ladderX(1) };
            });
            expect(r.after).toBeLessThan(r.before);
            expect(r.after).toBeGreaterThanOrEqual(r.ladder);
        });

        test('touching an enemy costs a life and resets the chef', async ({ page }) => {
            const r = await page.evaluate(() => {
                startGame();
                enemies.length = 0;
                placeChef(300, floorY(4));
                spawnEnemy(302, floorY(4));
                step(0.016);
                return { lives, x: chef.x, spawnX: CHEF_SPAWN.x };
            });
            expect(r.lives).toBe(2);
            expect(r.x).toBeCloseTo(r.spawnX, 5);
        });

        test('losing the last life ends the game', async ({ page }) => {
            const s = await page.evaluate(() => {
                startGame();
                enemies.length = 0;
                lives = 1;
                enemies.length = 0;
                placeChef(300, floorY(4));
                spawnEnemy(302, floorY(4));
                step(0.016);
                return state;
            });
            expect(s).toBe('over');
        });

        test('a falling piece squashes an enemy and scores', async ({ page }) => {
            const r = await page.evaluate(() => {
                startGame();
                enemies.length = 0;
                score = 0;
                const p = pieceAt(0, 0);
                const e = spawnEnemy(pieceLeft(p) + 40, floorY(1));
                dropPiece(p);
                for (let i = 0; i < 100 && e.state !== 'dead'; i++) step(0.016);
                return { state: e.state, score };
            });
            expect(r.state).toBe('dead');
            expect(r.score).toBeGreaterThan(await page.evaluate(() => DROP_POINTS));
        });

        test('a squashed enemy respawns after a delay', async ({ page }) => {
            const r = await page.evaluate(() => {
                startGame();
                enemies.length = 0;
                const p = pieceAt(0, 0);
                const e = spawnEnemy(pieceLeft(p) + 40, floorY(1));
                dropPiece(p);
                for (let i = 0; i < 100 && e.state !== 'dead'; i++) step(0.016);
                placeChef(600, floorY(0)); // stay away so it cannot immediately catch us
                for (let i = 0; i < 60 * (RESPAWN_DELAY + 1) && e.state === 'dead'; i++) step(0.016);
                return { state: e.state, x: e.x, spawnX: e.spawn.x };
            });
            expect(r.state).toBe('chase');
            expect(Math.abs(r.x - r.spawnX)).toBeLessThan(3);
        });

        test('a dead enemy cannot hurt the chef', async ({ page }) => {
            const lives = await page.evaluate(() => {
                startGame();
                enemies.length = 0;
                const e = spawnEnemy(300, floorY(4));
                e.state = 'dead';
                e.timer = 99;
                placeChef(300, floorY(4));
                for (let i = 0; i < 20; i++) step(0.016);
                return lives;
            });
            expect(lives).toBe(3);
        });
    });

    // -----------------------------------------------------------------------
    // Level completion
    // -----------------------------------------------------------------------
    test.describe('levels', () => {
        test('dropping the top bun cascades a whole burger onto the plate', async ({ page }) => {
            const r = await page.evaluate(() => {
                startGame();
                enemies.length = 0;
                dropPiece(pieceAt(0, 0));
                for (let i = 0; i < 300 && pieces.some((p) => p.state === 'fall'); i++) step(0.016);
                const stack0 = pieces.filter((p) => p.stack === 0);
                const others = pieces.filter((p) => p.stack !== 0);
                return {
                    plated: stack0.every((p) => p.state === 'plate'),
                    untouched: others.every((p) => p.state === 'rest' && p.floor === p.home),
                    piles: stack0.map((p) => p.pile).sort(),
                };
            });
            expect(r.plated).toBe(true);
            expect(r.untouched).toBe(true);
            expect(r.piles).toEqual([0, 1, 2, 3]);   // served neatly stacked
        });

        test('serving every burger completes the level', async ({ page }) => {
            const r = await page.evaluate(() => {
                startGame();
                enemies.length = 0;
                for (let s = 0; s < STACK_COLS.length; s++) dropPiece(pieceAt(s, 0));
                for (let i = 0; i < 400 && level === 1; i++) step(0.016);
                return { level, resting: pieces.every((p) => p.state === 'rest') };
            });
            expect(r.level).toBe(2);
            expect(r.resting).toBe(true);
        });

        test('completing a level awards the bonus and a fresh set of burgers', async ({ page }) => {
            const r = await page.evaluate(() => {
                startGame();
                enemies.length = 0;
                dropPiece(pieceAt(0, 0));
                const before = score;
                const lvl = level;
                completeLevel();
                return {
                    gained: score - before,
                    bonus: LEVEL_BONUS,
                    level: level - lvl,
                    home: pieces.every((p) => p.floor === p.home && p.state === 'rest'),
                };
            });
            expect(r.gained).toBe(r.bonus);
            expect(r.level).toBe(1);
            expect(r.home).toBe(true);
        });

        test('a new level refills the pepper', async ({ page }) => {
            const p = await page.evaluate(() => {
                startGame();
                enemies.length = 0;
                pepper = 0;
                completeLevel();
                return pepper;
            });
            expect(p).toBe(5);
        });

        test('enemies get faster on later levels', async ({ page }) => {
            const r = await page.evaluate(() => {
                startGame();
                enemies.length = 0;
                level = 1;
                const slow = enemySpeed();
                level = 4;
                return { slow, fast: enemySpeed() };
            });
            expect(r.fast).toBeGreaterThan(r.slow);
        });
    });

    // -----------------------------------------------------------------------
    // Scoring & best
    // -----------------------------------------------------------------------
    test.describe('scoring', () => {
        test('best score updates on game over when beaten', async ({ page }) => {
            await page.evaluate(() => { startGame(); score = 7300; updateHud(); endGame(); });
            await expect(page.locator('#best')).toHaveText('7300');
        });

        test('best score persists to localStorage', async ({ page }) => {
            await page.evaluate(() => { startGame(); score = 1550; updateHud(); endGame(); });
            const stored = await page.evaluate(() => window.localStorage.getItem('burgertime-best'));
            expect(parseInt(stored, 10)).toBe(1550);
        });

        test('best score is not lowered by a worse run', async ({ page }) => {
            await page.evaluate(() => window.localStorage.setItem('burgertime-best', '9000'));
            await page.reload();
            await page.evaluate(() => { startGame(); score = 10; updateHud(); endGame(); });
            await expect(page.locator('#best')).toHaveText('9000');
        });

        test('game over shows the overlay with Play Again', async ({ page }) => {
            await page.evaluate(() => { startGame(); endGame(); });
            await expect(page.locator('#overlay')).toHaveClass(/visible/);
            await expect(page.locator('#btn-start')).toHaveText('Play Again');
        });
    });

    // -----------------------------------------------------------------------
    // Pause & restart
    // -----------------------------------------------------------------------
    test.describe('pause and restart', () => {
        test('pausing freezes falling pieces', async ({ page }) => {
            const { before, after } = await page.evaluate(() => {
                startGame();
                enemies.length = 0;
                const p = pieceAt(0, 0);
                dropPiece(p);
                togglePause();
                const before = p.y;
                for (let i = 0; i < 20; i++) step(0.016);
                return { before, after: p.y };
            });
            expect(after).toBe(before);
        });

        test('resuming lets pieces fall again', async ({ page }) => {
            const moved = await page.evaluate(() => {
                startGame();
                enemies.length = 0;
                const p = pieceAt(0, 0);
                dropPiece(p);
                togglePause();
                togglePause();
                const before = p.y;
                for (let i = 0; i < 20; i++) step(0.016);
                return p.y > before;
            });
            expect(moved).toBe(true);
        });

        test('restart resets score, level, lives and the burgers', async ({ page }) => {
            const r = await page.evaluate(() => {
                startGame();
                enemies.length = 0;
                score = 999;
                level = 4;
                lives = 1;
                dropPiece(pieceAt(0, 0));
                endGame();
                startGame();
                enemies.length = 0;
                return {
                    score, level, lives, state,
                    resting: pieces.every((p) => p.state === 'rest'),
                };
            });
            expect(r.score).toBe(0);
            expect(r.level).toBe(1);
            expect(r.lives).toBe(3);
            expect(r.state).toBe('running');
            expect(r.resting).toBe(true);
        });

        test('the game does not advance while idle', async ({ page }) => {
            const same = await page.evaluate(() => {
                const p = pieces[0];
                const y = p.y;
                for (let i = 0; i < 20; i++) step(0.016);
                return p.y === y;
            });
            expect(same).toBe(true);
        });
    });

    // -----------------------------------------------------------------------
    // Keyboard bindings
    // -----------------------------------------------------------------------
    test.describe('keyboard', () => {
        test('ArrowRight walks the chef right', async ({ page }) => {
            await page.evaluate(() => { startGame(); placeChef(300, floorY(4)); });
            const before = await page.evaluate(() => chef.x);
            await page.keyboard.down('ArrowRight');
            await page.evaluate(() => { for (let i = 0; i < 20; i++) step(0.016); });
            await page.keyboard.up('ArrowRight');
            expect(await page.evaluate(() => chef.x)).toBeGreaterThan(before);
        });

        test('releasing the key stops the chef', async ({ page }) => {
            await page.evaluate(() => { startGame(); placeChef(300, floorY(4)); });
            await page.keyboard.down('ArrowRight');
            await page.evaluate(() => { for (let i = 0; i < 10; i++) step(0.016); });
            await page.keyboard.up('ArrowRight');
            const before = await page.evaluate(() => chef.x);
            await page.evaluate(() => { for (let i = 0; i < 20; i++) step(0.016); });
            expect(await page.evaluate(() => chef.x)).toBe(before);
        });

        test('Space sprays pepper while running', async ({ page }) => {
            await page.evaluate(() => { startGame(); });
            await page.keyboard.press('Space');
            expect(await page.evaluate(() => pepper)).toBe(4);
        });

        test('P pauses and resumes', async ({ page }) => {
            await page.evaluate(() => startGame());
            await page.keyboard.press('KeyP');
            expect(await page.evaluate(() => state)).toBe('paused');
            await page.keyboard.press('KeyP');
            expect(await page.evaluate(() => state)).toBe('running');
        });
    });
});
