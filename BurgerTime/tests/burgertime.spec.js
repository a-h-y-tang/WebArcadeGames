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
            await expect(page.locator('#overlay-sub')).toContainText(/space|enter|start/i);
        });

        test('canvas is 640x560', async ({ page }) => {
            const canvas = page.locator('#canvas');
            await expect(canvas).toHaveAttribute('width', '640');
            await expect(canvas).toHaveAttribute('height', '560');
        });

        test('HUD starts at zero score, 3 lives, level 1', async ({ page }) => {
            await expect(page.locator('#score')).toHaveText('0');
            await expect(page.locator('#lives')).toHaveText('3');
            await expect(page.locator('#level')).toHaveText('1');
            await expect(page.locator('#best')).toHaveText('0');
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
        test('there are 6 floors in top-to-bottom order', async ({ page }) => {
            const floors = await page.evaluate(() => FLOOR_Y);
            expect(floors).toHaveLength(6);
            for (let i = 1; i < floors.length; i++) {
                expect(floors[i]).toBeGreaterThan(floors[i - 1]);
            }
        });

        test('there are 4 burger columns and 4 plates', async ({ page }) => {
            const cols = await page.evaluate(() => COLS_X);
            expect(cols).toHaveLength(4);
            expect(await page.evaluate(() => plates.length)).toBe(4);
        });

        test('plates sit below the bottom floor', async ({ page }) => {
            const { plateY, bottom } = await page.evaluate(() => ({
                plateY: PLATE_Y,
                bottom: FLOOR_Y[FLOOR_Y.length - 1],
            }));
            expect(plateY).toBeGreaterThan(bottom);
        });

        test('outer ladders span every floor', async ({ page }) => {
            const spans = await page.evaluate(() =>
                LADDERS.filter((l) => l.top === 0 && l.bottom === FLOOR_Y.length - 1).length);
            expect(spans).toBeGreaterThanOrEqual(2);
        });

        test('no ladder overlaps an ingredient span', async ({ page }) => {
            const overlaps = await page.evaluate(() => {
                const bad = [];
                for (const l of LADDERS) {
                    for (const cx of COLS_X) {
                        if (Math.abs(l.x - cx) < ING_W / 2 + 8) bad.push([l.x, cx]);
                    }
                }
                return bad;
            });
            expect(overlaps).toEqual([]);
        });

        test('level starts with 16 ingredients, 4 per column', async ({ page }) => {
            const counts = await page.evaluate(() => {
                startGame();
                return COLS_X.map((_, c) => ingredients.filter((i) => i.col === c).length);
            });
            expect(counts).toEqual([4, 4, 4, 4]);
        });

        test('ingredients start on distinct floors within a column', async ({ page }) => {
            const floors = await page.evaluate(() => {
                startGame();
                return ingredients.filter((i) => i.col === 0).map((i) => i.floor).sort();
            });
            expect(new Set(floors).size).toBe(floors.length);
        });

        test('every ingredient has 4 unpressed segments', async ({ page }) => {
            const ok = await page.evaluate(() => {
                startGame();
                return ingredients.every((i) => i.segs.length === 4 && i.segs.every((s) => !s));
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

        test('Enter starts the game', async ({ page }) => {
            await page.keyboard.press('Enter');
            expect(await page.evaluate(() => state)).toBe('running');
        });

        test('Start button starts the game', async ({ page }) => {
            await page.locator('#btn-start').click();
            expect(await page.evaluate(() => state)).toBe('running');
        });

        test('a fresh game has 3 lives, level 1, full pepper', async ({ page }) => {
            const s = await page.evaluate(() => {
                startGame();
                return { lives, level, score, peppers, start: PEPPER_START };
            });
            expect(s.lives).toBe(3);
            expect(s.level).toBe(1);
            expect(s.score).toBe(0);
            expect(s.peppers).toBe(s.start);
            expect(s.peppers).toBeGreaterThan(0);
        });

        test('chef starts standing on the bottom floor', async ({ page }) => {
            const p = await page.evaluate(() => {
                startGame();
                return { floor: player.floor, y: player.y, bottom: FLOOR_Y.length - 1 };
            });
            expect(p.floor).toBe(p.bottom);
        });

        test('no plated ingredients at the start', async ({ page }) => {
            const plated = await page.evaluate(() => {
                startGame();
                return ingredients.filter((i) => i.plated).length;
            });
            expect(plated).toBe(0);
        });
    });

    // -----------------------------------------------------------------------
    // Chef movement
    // -----------------------------------------------------------------------
    test.describe('chef movement', () => {
        test('walking right increases x', async ({ page }) => {
            const moved = await page.evaluate(() => {
                startGame();
                player.x = 300;
                setMove(1, 0);
                step(0.5);
                return player.x;
            });
            expect(moved).toBeGreaterThan(300);
        });

        test('walking left decreases x', async ({ page }) => {
            const moved = await page.evaluate(() => {
                startGame();
                player.x = 300;
                setMove(-1, 0);
                step(0.5);
                return player.x;
            });
            expect(moved).toBeLessThan(300);
        });

        test('chef is clamped inside the play field', async ({ page }) => {
            const bounds = await page.evaluate(() => {
                startGame();
                setMove(-1, 0);
                for (let i = 0; i < 100; i++) step(0.1);
                const left = player.x;
                setMove(1, 0);
                for (let i = 0; i < 100; i++) step(0.1);
                return { left, right: player.x, w: CANVAS_W };
            });
            expect(bounds.left).toBeGreaterThanOrEqual(0);
            expect(bounds.right).toBeLessThanOrEqual(bounds.w);
        });

        test('cannot climb when not on a ladder', async ({ page }) => {
            const res = await page.evaluate(() => {
                startGame();
                player.x = 250; // between ladders
                const y0 = player.y;
                setMove(0, -1);
                step(0.5);
                return { y0, y1: player.y, climbing: player.climbing };
            });
            expect(res.y1).toBe(res.y0);
            expect(res.climbing).toBe(false);
        });

        test('climbing up on a ladder decreases y', async ({ page }) => {
            const res = await page.evaluate(() => {
                startGame();
                const ladder = LADDERS.find((l) => l.top === 0 && l.bottom === FLOOR_Y.length - 1);
                player.x = ladder.x;
                const y0 = player.y;
                setMove(0, -1);
                step(0.4);
                return { y0, y1: player.y, climbing: player.climbing };
            });
            expect(res.y1).toBeLessThan(res.y0);
            expect(res.climbing).toBe(true);
        });

        test('climbing to the next floor updates the floor index', async ({ page }) => {
            const res = await page.evaluate(() => {
                startGame();
                const ladder = LADDERS.find((l) => l.top === 0 && l.bottom === FLOOR_Y.length - 1);
                player.x = ladder.x;
                const f0 = player.floor;
                setMove(0, -1);
                for (let i = 0; i < 600 && player.floor === f0; i++) step(1 / 60);
                return { f0, f1: player.floor, y: player.y, y0: FLOOR_Y[f0] };
            });
            expect(res.f1).toBe(res.f0 - 1);
            expect(res.y).toBeLessThan(res.y0);
        });

        test('stepping off a ladder onto a floor lines the chef up with it', async ({ page }) => {
            const res = await page.evaluate(() => {
                startGame();
                const ladder = LADDERS.find((l) => l.top === 0 && l.bottom === FLOOR_Y.length - 1);
                player.x = ladder.x;
                const f0 = player.floor;
                setMove(0, -1);
                for (let i = 0; i < 600 && player.floor === f0; i++) step(1 / 60);
                setMove(1, 0); // walk off the ladder
                for (let i = 0; i < 30; i++) step(1 / 60);
                return { y: player.y, floorY: FLOOR_Y[player.floor], climbing: player.climbing };
            });
            expect(res.y).toBeCloseTo(res.floorY, 1);
            expect(res.climbing).toBe(false);
        });

        test('cannot climb above the top floor', async ({ page }) => {
            const res = await page.evaluate(() => {
                startGame();
                const ladder = LADDERS.find((l) => l.top === 0 && l.bottom === FLOOR_Y.length - 1);
                player.x = ladder.x;
                setMove(0, -1);
                for (let i = 0; i < 600; i++) step(1 / 60);
                return { floor: player.floor, y: player.y, topY: FLOOR_Y[0] };
            });
            expect(res.floor).toBe(0);
            expect(res.y).toBeCloseTo(res.topY, 1);
        });

        test('cannot climb below the bottom floor', async ({ page }) => {
            const res = await page.evaluate(() => {
                startGame();
                const ladder = LADDERS.find((l) => l.top === 0 && l.bottom === FLOOR_Y.length - 1);
                player.x = ladder.x;
                setMove(0, 1);
                for (let i = 0; i < 600; i++) step(1 / 60);
                return {
                    floor: player.floor,
                    bottom: FLOOR_Y.length - 1,
                    y: player.y,
                    bottomY: FLOOR_Y[FLOOR_Y.length - 1],
                };
            });
            expect(res.floor).toBe(res.bottom);
            expect(res.y).toBeCloseTo(res.bottomY, 1);
        });

        test('x is locked to the ladder while climbing', async ({ page }) => {
            const res = await page.evaluate(() => {
                startGame();
                const ladder = LADDERS.find((l) => l.top === 0 && l.bottom === FLOOR_Y.length - 1);
                player.x = ladder.x;
                setMove(0, -1);
                step(0.2);
                setMove(1, -1);
                step(0.2);
                return { x: player.x, lx: ladder.x, climbing: player.climbing };
            });
            expect(res.climbing).toBe(true);
            expect(res.x).toBeCloseTo(res.lx, 1);
        });

        test('arrow keys drive the chef', async ({ page }) => {
            await page.keyboard.press('Space');
            const before = await page.evaluate(() => player.x);
            await page.keyboard.down('ArrowRight');
            await page.waitForTimeout(200);
            await page.keyboard.up('ArrowRight');
            expect(await page.evaluate(() => player.x)).toBeGreaterThan(before);
        });
    });

    // -----------------------------------------------------------------------
    // Ingredients
    // -----------------------------------------------------------------------
    test.describe('ingredients', () => {
        test('standing on a segment presses it', async ({ page }) => {
            const segs = await page.evaluate(() => {
                startGame();
                const ing = ingredients[0];
                standOnSegment(ing, 0);
                step(1 / 60);
                return ing.segs.slice();
            });
            expect(segs[0]).toBe(true);
            expect(segs.slice(1)).toEqual([false, false, false]);
        });

        test('walking a whole ingredient drops it one floor', async ({ page }) => {
            const res = await page.evaluate(() => {
                startGame();
                const ing = ingredients.find((i) => i.floor < FLOOR_Y.length - 1);
                const f0 = ing.floor;
                walkOver(ing);
                for (let i = 0; i < 300; i++) step(1 / 60);
                return { f0, f1: ing.floor, falling: ing.falling, y: ing.y, floorY: FLOOR_Y[ing.floor] };
            });
            expect(res.f1).toBe(res.f0 + 1);
            expect(res.falling).toBe(false);
            expect(res.y).toBeCloseTo(res.floorY, 0);
        });

        test('a dropped ingredient resets its segments', async ({ page }) => {
            const segs = await page.evaluate(() => {
                startGame();
                const ing = ingredients.find((i) => i.floor < FLOOR_Y.length - 1);
                walkOver(ing);
                for (let i = 0; i < 300; i++) step(1 / 60);
                return ing.segs.slice();
            });
            expect(segs).toEqual([false, false, false, false]);
        });

        test('dropping scores points', async ({ page }) => {
            const res = await page.evaluate(() => {
                startGame();
                const before = score;
                const ing = ingredients.find((i) => i.floor < FLOOR_Y.length - 1);
                walkOver(ing);
                for (let i = 0; i < 300; i++) step(1 / 60);
                return { before, after: score };
            });
            expect(res.after).toBeGreaterThan(res.before);
        });

        test('an ingredient falling onto another knocks it loose too', async ({ page }) => {
            const res = await page.evaluate(() => {
                startGame();
                // Put two ingredients of column 0 on adjacent floors.
                const col = ingredients.filter((i) => i.col === 0).sort((a, b) => a.floor - b.floor);
                const upper = col[0], lower = col[1];
                lower.floor = upper.floor + 1;
                lower.y = FLOOR_Y[lower.floor];
                const lowerStart = lower.floor;
                walkOver(upper);
                for (let i = 0; i < 400; i++) step(1 / 60);
                return { lowerStart, lowerEnd: lower.floor, upperEnd: upper.floor };
            });
            expect(res.lowerEnd).toBeGreaterThan(res.lowerStart);
            expect(res.upperEnd).toBe(res.lowerEnd - 1);
        });

        test('an ingredient on the bottom floor lands on its plate', async ({ page }) => {
            const res = await page.evaluate(() => {
                startGame();
                const ing = ingredients[0];
                ing.floor = FLOOR_Y.length - 1;
                ing.y = FLOOR_Y[ing.floor];
                walkOver(ing);
                for (let i = 0; i < 400; i++) step(1 / 60);
                return { plated: ing.plated, count: plates[ing.col].length, y: ing.y, plateY: PLATE_Y };
            });
            expect(res.plated).toBe(true);
            expect(res.count).toBe(1);
            expect(res.y).toBeLessThanOrEqual(res.plateY);
        });

        test('plated ingredients cannot be pressed again', async ({ page }) => {
            const segs = await page.evaluate(() => {
                startGame();
                const ing = ingredients[0];
                ing.floor = FLOOR_Y.length - 1;
                ing.y = FLOOR_Y[ing.floor];
                walkOver(ing);
                for (let i = 0; i < 400; i++) step(1 / 60);
                standOnSegment(ing, 0);
                step(1 / 60);
                return ing.segs.slice();
            });
            expect(segs).toEqual([false, false, false, false]);
        });

        test('plating all 16 ingredients clears the level', async ({ page }) => {
            const res = await page.evaluate(() => {
                startGame();
                plateAll();
                step(1 / 60);
                return { state, level, score };
            });
            expect(res.state).toBe('levelclear');
            expect(res.score).toBeGreaterThanOrEqual(1000);
        });

        test('the next level rebuilds the board and bumps the level counter', async ({ page }) => {
            const res = await page.evaluate(() => {
                startGame();
                plateAll();
                step(1 / 60);
                for (let i = 0; i < 400; i++) step(1 / 60);
                return {
                    state,
                    level,
                    ingredients: ingredients.length,
                    plated: ingredients.filter((i) => i.plated).length,
                };
            });
            expect(res.state).toBe('running');
            expect(res.level).toBe(2);
            expect(res.ingredients).toBe(16);
            expect(res.plated).toBe(0);
        });
    });

    // -----------------------------------------------------------------------
    // Enemies
    // -----------------------------------------------------------------------
    test.describe('enemies', () => {
        test('enemies appear once the game is running', async ({ page }) => {
            const n = await page.evaluate(() => {
                startGame();
                // Long enough for the first spawn, short enough that the idle
                // chef has not been caught yet.
                for (let i = 0; i < 240; i++) step(1 / 60);
                return enemies.length;
            });
            expect(n).toBeGreaterThan(0);
        });

        test('an enemy walks toward the chef on the same floor', async ({ page }) => {
            const res = await page.evaluate(() => {
                startGame();
                enemies.length = 0;
                const e = spawnEnemy({ x: 600, floor: 0 });
                player.x = 100;
                player.y = FLOOR_Y[0];
                player.floor = 0;
                const x0 = e.x;
                for (let i = 0; i < 30; i++) step(1 / 60);
                return { x0, x1: e.x };
            });
            expect(res.x1).toBeLessThan(res.x0);
        });

        test('an enemy climbs toward a chef on another floor', async ({ page }) => {
            const res = await page.evaluate(() => {
                startGame();
                enemies.length = 0;
                const ladder = LADDERS.find((l) => l.top === 0 && l.bottom === FLOOR_Y.length - 1);
                const e = spawnEnemy({ x: ladder.x, floor: FLOOR_Y.length - 1 });
                player.floor = 0;
                player.x = ladder.x;
                player.y = FLOOR_Y[0];
                const y0 = e.y;
                for (let i = 0; i < 60; i++) step(1 / 60);
                return { y0, y1: e.y };
            });
            expect(res.y1).toBeLessThan(res.y0);
        });

        test('touching an enemy costs a life and resets positions', async ({ page }) => {
            const res = await page.evaluate(() => {
                startGame();
                enemies.length = 0;
                spawnEnemy({ x: player.x, floor: player.floor });
                const before = lives;
                step(1 / 60);
                return { before, after: lives, enemies: enemies.length };
            });
            expect(res.after).toBe(res.before - 1);
        });

        test('losing the last life ends the game', async ({ page }) => {
            const res = await page.evaluate(() => {
                startGame();
                lives = 1;
                enemies.length = 0;
                spawnEnemy({ x: player.x, floor: player.floor });
                step(1 / 60);
                return { state, lives };
            });
            expect(res.state).toBe('over');
            expect(res.lives).toBe(0);
        });

        test('game over shows the overlay with the final score', async ({ page }) => {
            await page.evaluate(() => {
                startGame();
                score = 750;
                lives = 1;
                enemies.length = 0;
                spawnEnemy({ x: player.x, floor: player.floor });
                step(1 / 60);
            });
            await expect(page.locator('#overlay')).toHaveClass(/visible/);
            await expect(page.locator('#overlay-score')).toContainText('750');
        });

        test('best score is stored after a game over', async ({ page }) => {
            const best = await page.evaluate(() => {
                startGame();
                score = 1234;
                lives = 1;
                enemies.length = 0;
                spawnEnemy({ x: player.x, floor: player.floor });
                step(1 / 60);
                return window.localStorage.getItem('burgertime-best');
            });
            expect(best).toBe('1234');
        });

        test('a falling ingredient squashes an enemy standing on it', async ({ page }) => {
            const res = await page.evaluate(() => {
                startGame();
                enemies.length = 0;
                const ing = ingredients.find((i) => i.floor < FLOOR_Y.length - 1);
                const e = spawnEnemy({ x: COLS_X[ing.col], floor: ing.floor });
                player.floor = 0;
                player.x = 620;
                const before = score;
                walkOver(ing);
                // Stop well before the respawn delay so the squash is observable.
                for (let i = 0; i < 60; i++) step(1 / 60);
                return { alive: e.alive, before, after: score };
            });
            expect(res.alive).toBe(false);
            expect(res.after).toBeGreaterThanOrEqual(res.before + 100);
        });

        test('squashed enemies respawn after a delay', async ({ page }) => {
            const res = await page.evaluate(() => {
                startGame();
                enemies.length = 0;
                const ing = ingredients.find((i) => i.floor < FLOOR_Y.length - 1);
                spawnEnemy({ x: COLS_X[ing.col], floor: ing.floor });
                player.floor = 0;
                player.x = 620;
                walkOver(ing);
                for (let i = 0; i < 900; i++) step(1 / 60);
                return enemies.filter((e) => e.alive).length;
            });
            expect(res).toBeGreaterThan(0);
        });
    });

    // -----------------------------------------------------------------------
    // Pepper
    // -----------------------------------------------------------------------
    test.describe('pepper', () => {
        test('spraying pepper uses one shaker', async ({ page }) => {
            const res = await page.evaluate(() => {
                startGame();
                const before = peppers;
                sprayPepper();
                return { before, after: peppers, clouds: clouds.length };
            });
            expect(res.after).toBe(res.before - 1);
            expect(res.clouds).toBe(1);
        });

        test('pepper cannot be sprayed with an empty shaker', async ({ page }) => {
            const res = await page.evaluate(() => {
                startGame();
                peppers = 0;
                sprayPepper();
                return { peppers, clouds: clouds.length };
            });
            expect(res.peppers).toBe(0);
            expect(res.clouds).toBe(0);
        });

        test('pepper stuns an enemy in front of the chef', async ({ page }) => {
            const res = await page.evaluate(() => {
                startGame();
                enemies.length = 0;
                player.x = 300;
                player.facing = 1;
                const e = spawnEnemy({ x: 340, floor: player.floor });
                sprayPepper();
                step(1 / 60);
                const stunned = e.stun > 0;
                const x0 = e.x;
                for (let i = 0; i < 30; i++) step(1 / 60);
                return { stunned, moved: Math.abs(e.x - x0) };
            });
            expect(res.stunned).toBe(true);
            expect(res.moved).toBeLessThan(1);
        });

        test('a stunned enemy does not cost a life', async ({ page }) => {
            const res = await page.evaluate(() => {
                startGame();
                enemies.length = 0;
                player.x = 300;
                player.facing = 1;
                const e = spawnEnemy({ x: 340, floor: player.floor });
                sprayPepper();
                step(1 / 60);
                const before = lives;
                e.x = player.x;
                step(1 / 60);
                return { before, after: lives };
            });
            expect(res.after).toBe(res.before);
        });

        test('pepper clouds expire', async ({ page }) => {
            const n = await page.evaluate(() => {
                startGame();
                sprayPepper();
                for (let i = 0; i < 120; i++) step(1 / 60);
                return clouds.length;
            });
            expect(n).toBe(0);
        });

        test('pepper stock refills on the next level', async ({ page }) => {
            const res = await page.evaluate(() => {
                startGame();
                const full = peppers;
                peppers = 0;
                plateAll();
                for (let i = 0; i < 400; i++) step(1 / 60);
                return { full, after: peppers };
            });
            expect(res.after).toBe(res.full);
        });

        test('the pepper HUD tracks the stock', async ({ page }) => {
            await page.evaluate(() => { startGame(); peppers = 2; updateHud(); });
            await expect(page.locator('#peppers')).toHaveText('2');
        });
    });

    // -----------------------------------------------------------------------
    // Pause, restart and HUD
    // -----------------------------------------------------------------------
    test.describe('pause and restart', () => {
        test('P pauses and resumes', async ({ page }) => {
            await page.keyboard.press('Space');
            await page.keyboard.press('p');
            expect(await page.evaluate(() => state)).toBe('paused');
            await page.keyboard.press('p');
            expect(await page.evaluate(() => state)).toBe('running');
        });

        test('nothing moves while paused', async ({ page }) => {
            const res = await page.evaluate(() => {
                startGame();
                togglePause();
                const x0 = player.x;
                setMove(1, 0);
                for (let i = 0; i < 60; i++) step(1 / 60);
                return { x0, x1: player.x };
            });
            expect(res.x1).toBe(res.x0);
        });

        test('P does nothing before the game starts', async ({ page }) => {
            await page.keyboard.press('p');
            expect(await page.evaluate(() => state)).toBe('idle');
        });

        test('Space restarts after game over', async ({ page }) => {
            await page.evaluate(() => {
                startGame();
                score = 500;
                lives = 1;
                enemies.length = 0;
                spawnEnemy({ x: player.x, floor: player.floor });
                step(1 / 60);
            });
            await page.keyboard.press('Space');
            const res = await page.evaluate(() => ({ state, score, lives, level }));
            expect(res.state).toBe('running');
            expect(res.score).toBe(0);
            expect(res.lives).toBe(3);
            expect(res.level).toBe(1);
        });

        test('the HUD reflects score, lives and level', async ({ page }) => {
            await page.evaluate(() => {
                startGame();
                score = 3400;
                lives = 2;
                level = 5;
                updateHud();
            });
            await expect(page.locator('#score')).toHaveText('3400');
            await expect(page.locator('#lives')).toHaveText('2');
            await expect(page.locator('#level')).toHaveText('5');
        });

        test('the help panel documents the controls', async ({ page }) => {
            const help = page.locator('.help');
            await expect(help).toContainText(/pepper/i);
            await expect(help).toContainText(/pause/i);
        });
    });

    // -----------------------------------------------------------------------
    // Rendering
    // -----------------------------------------------------------------------
    test.describe('rendering', () => {
        test('the canvas is painted after starting', async ({ page }) => {
            const painted = await page.evaluate(() => {
                startGame();
                draw();
                const data = ctx.getImageData(0, 0, CANVAS_W, CANVAS_H).data;
                for (let i = 3; i < data.length; i += 4) if (data[i] !== 0) return true;
                return false;
            });
            expect(painted).toBe(true);
        });

        test('drawing never throws in any state', async ({ page }) => {
            const err = await page.evaluate(() => {
                try {
                    draw();
                    startGame();
                    draw();
                    togglePause();
                    draw();
                    togglePause();
                    plateAll();
                    step(1 / 60);
                    draw();
                    endGame();
                    draw();
                    return null;
                } catch (e) {
                    return String(e);
                }
            });
            expect(err).toBeNull();
        });

        test('no console errors on load', async ({ page }) => {
            const errors = [];
            page.on('pageerror', (e) => errors.push(String(e)));
            await page.reload();
            await page.waitForTimeout(300);
            expect(errors).toEqual([]);
        });
    });
});
