const { test, expect } = require('@playwright/test');
const path = require('path');
const { pathToFileURL } = require('url');

const GAME_URL = pathToFileURL(path.resolve(__dirname, '../index.html')).href;

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

        test('HUD starts at zero score, level 1, full lives and peppers', async ({ page }) => {
            await expect(page.locator('#score')).toHaveText('0');
            await expect(page.locator('#level')).toHaveText('1');
            await expect(page.locator('#lives')).toHaveText('3');
            await expect(page.locator('#peppers')).toHaveText('5');
            await expect(page.locator('#best')).toHaveText('0');
        });

        test('canvas is 640x560', async ({ page }) => {
            const canvas = page.locator('#canvas');
            await expect(canvas).toHaveAttribute('width', '640');
            await expect(canvas).toHaveAttribute('height', '560');
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
    // Starting a game
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

        test('a fresh game resets score, level, lives and peppers', async ({ page }) => {
            const s = await page.evaluate(() => {
                startGame();
                return { score, level, lives, peppers };
            });
            expect(s).toEqual({ score: 0, level: 1, lives: 3, peppers: 5 });
        });

        test('the board holds four burgers of four ingredients each', async ({ page }) => {
            const s = await page.evaluate(() => {
                startGame();
                return {
                    total: pieces.length,
                    cols: new Set(pieces.map((p) => p.col)).size,
                    onPlate: pieces.filter((p) => p.onPlate).length,
                };
            });
            expect(s.total).toBe(16);
            expect(s.cols).toBe(4);
            expect(s.onPlate).toBe(0);
        });

        test('every ingredient starts fully un-stepped', async ({ page }) => {
            const stepped = await page.evaluate(() => {
                startGame();
                return pieces.filter((p) => p.segs.some(Boolean)).length;
            });
            expect(stepped).toBe(0);
        });

        test('the chef starts on the board and inside the canvas', async ({ page }) => {
            const c = await page.evaluate(() => {
                startGame();
                return { x: chef.x, y: chef.y, floor: chef.floor, w: CANVAS_W };
            });
            expect(c.x).toBeGreaterThan(0);
            expect(c.x).toBeLessThan(c.w);
            expect(c.floor).toBeGreaterThanOrEqual(0);
            expect(c.y).toBeGreaterThan(0);
        });

        test('enemies are on the board once the game starts', async ({ page }) => {
            const n = await page.evaluate(() => {
                startGame();
                return enemies.length;
            });
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
                setChef(300, 5);
                const before = chef.x;
                moveChef(1, 0);
                for (let i = 0; i < 10; i++) step(0.016);
                return { before, after: chef.x };
            });
            expect(after).toBeGreaterThan(before);
        });

        test('walking left decreases the chef x', async ({ page }) => {
            const { before, after } = await page.evaluate(() => {
                startGame();
                setChef(300, 5);
                const before = chef.x;
                moveChef(-1, 0);
                for (let i = 0; i < 10; i++) step(0.016);
                return { before, after: chef.x };
            });
            expect(after).toBeLessThan(before);
        });

        test('the chef cannot walk off either edge', async ({ page }) => {
            const { left, right, w } = await page.evaluate(() => {
                startGame();
                setChef(40, 5);
                moveChef(-1, 0);
                for (let i = 0; i < 300; i++) step(0.016);
                const left = chef.x;
                setChef(600, 5);
                moveChef(1, 0);
                for (let i = 0; i < 300; i++) step(0.016);
                return { left, right: chef.x, w: CANVAS_W };
            });
            expect(left).toBeGreaterThanOrEqual(0);
            expect(right).toBeLessThanOrEqual(w);
        });

        test('the chef climbs up a ladder', async ({ page }) => {
            const { before, after } = await page.evaluate(() => {
                startGame();
                setChef(LADDER_X[1], 5);
                const before = chef.y;
                moveChef(0, -1);
                for (let i = 0; i < 20; i++) step(0.016);
                return { before, after: chef.y };
            });
            expect(after).toBeLessThan(before);
        });

        test('climbing a full ladder span lands the chef on the floor above', async ({ page }) => {
            const c = await page.evaluate(() => {
                startGame();
                setChef(LADDER_X[1], 5);
                moveChef(0, -1);
                for (let i = 0; i < 200; i++) {
                    step(0.016);
                    if (chef.floor === 4) break;
                }
                return { floor: chef.floor, y: chef.y, target: FLOORS[4], onLadder: chef.onLadder };
            });
            expect(c.floor).toBe(4);
            expect(c.y).toBeCloseTo(c.target, 1);
        });

        test('the chef cannot climb where there is no ladder', async ({ page }) => {
            const { before, after } = await page.evaluate(() => {
                startGame();
                setChef(COL_X[0], 5);
                const before = chef.y;
                moveChef(0, -1);
                for (let i = 0; i < 30; i++) step(0.016);
                return { before, after: chef.y };
            });
            expect(after).toBe(before);
        });

        test('the chef cannot climb below the bottom floor', async ({ page }) => {
            const { after, bottom } = await page.evaluate(() => {
                startGame();
                setChef(LADDER_X[1], 5);
                moveChef(0, 1);
                for (let i = 0; i < 60; i++) step(0.016);
                return { after: chef.y, bottom: FLOORS[FLOORS.length - 1] };
            });
            expect(after).toBe(bottom);
        });

        test('ArrowRight moves the chef right', async ({ page }) => {
            await page.evaluate(() => { startGame(); setChef(300, 5); });
            const before = await page.evaluate(() => chef.x);
            await page.keyboard.down('ArrowRight');
            await page.evaluate(() => { for (let i = 0; i < 10; i++) step(0.016); });
            await page.keyboard.up('ArrowRight');
            expect(await page.evaluate(() => chef.x)).toBeGreaterThan(before);
        });
    });

    // -----------------------------------------------------------------------
    // Stepping on ingredients
    // -----------------------------------------------------------------------
    test.describe('stepping on ingredients', () => {
        test('walking over an ingredient marks the segment underfoot', async ({ page }) => {
            const segs = await page.evaluate(() => {
                startGame();
                const p = pieces.find((x) => x.floor === topFloorOf(0) && x.col === 0);
                setChef(p.x - PIECE_W / 2 + SEG_W / 2, p.floor);
                step(0.016);
                return p.segs.slice();
            });
            expect(segs[0]).toBe(true);
            expect(segs.slice(1).some(Boolean)).toBe(false);
        });

        test('walking the whole ingredient drops it', async ({ page }) => {
            const dropped = await page.evaluate(() => {
                startGame();
                const p = pieces.find((x) => x.col === 0 && x.floor === topFloorOf(0));
                for (let i = 0; i < 4; i++) {
                    setChef(p.x - PIECE_W / 2 + SEG_W * (i + 0.5), p.floor);
                    step(0.016);
                }
                return { segs: p.segs.slice(), falling: p.falling };
            });
            expect(dropped.segs).toEqual([true, true, true, true]);
            expect(dropped.falling).toBe(true);
        });

        test('dropping an ingredient scores points', async ({ page }) => {
            const s = await page.evaluate(() => {
                startGame();
                score = 0;
                dropPiece(pieces[0]);
                return score;
            });
            expect(s).toBe(50);
        });

        test('an ingredient the chef has not fully walked stays put', async ({ page }) => {
            const p = await page.evaluate(() => {
                startGame();
                const piece = pieces[0];
                piece.segs[0] = true;
                piece.segs[1] = true;
                for (let i = 0; i < 60; i++) step(0.016);
                return { falling: piece.falling, floor: piece.floor };
            });
            expect(p.falling).toBe(false);
        });

        test('a falling ingredient moves downward', async ({ page }) => {
            const { before, after } = await page.evaluate(() => {
                startGame();
                const p = pieces.find((x) => x.col === 0 && x.floor === topFloorOf(0));
                dropPiece(p);
                const before = p.y;
                for (let i = 0; i < 5; i++) step(0.016);
                return { before, after: p.y };
            });
            expect(after).toBeGreaterThan(before);
        });

        test('an ingredient falls exactly one floor when nothing is below it', async ({ page }) => {
            const r = await page.evaluate(() => {
                startGame();
                const p = pieces.find((x) => x.col === 0 && x.floor === topFloorOf(0));
                // clear the rest of the column so nothing is hit on the way down
                for (const other of pieces.filter((x) => x.col === 0 && x !== p)) {
                    other.floor = -99;
                    other.y = -999;
                }
                const from = p.floor;
                dropPiece(p);
                for (let i = 0; i < 400 && p.falling; i++) step(0.016);
                return { from, to: p.floor, y: p.y, target: FLOORS[from + 1], falling: p.falling };
            });
            expect(r.falling).toBe(false);
            expect(r.to).toBe(r.from + 1);
            expect(r.y).toBeCloseTo(r.target, 1);
        });

        test('landing on another ingredient pushes that one down a floor too', async ({ page }) => {
            const r = await page.evaluate(() => {
                startGame();
                const col = pieces.filter((x) => x.col === 0).sort((a, b) => a.floor - b.floor);
                const top = col[0];
                const below = col[1];
                const topFrom = top.floor;
                const belowFrom = below.floor;
                dropPiece(top);
                for (let i = 0; i < 600 && (top.falling || below.falling); i++) step(0.016);
                return {
                    top: top.floor - topFrom,
                    below: below.floor - belowFrom,
                    settled: !top.falling && !below.falling,
                };
            });
            expect(r.settled).toBe(true);
            expect(r.top).toBe(1);
            expect(r.below).toBe(1);
        });

        test('an ingredient reaching the bottom lands on the plate', async ({ page }) => {
            const r = await page.evaluate(() => {
                startGame();
                const p = pieces.find((x) => x.col === 0);
                for (const other of pieces.filter((x) => x.col === 0 && x !== p)) {
                    other.floor = -99;
                    other.y = -999;
                }
                p.floor = FLOORS.length - 2;
                p.y = FLOORS[p.floor];
                dropPiece(p);
                for (let i = 0; i < 400 && p.falling; i++) step(0.016);
                return { onPlate: p.onPlate, plate: plateCount[0] };
            });
            expect(r.onPlate).toBe(true);
            expect(r.plate).toBe(1);
        });

        test('a landed ingredient forgets its footprints', async ({ page }) => {
            const segs = await page.evaluate(() => {
                startGame();
                const p = pieces.find((x) => x.col === 0 && x.floor === topFloorOf(0));
                for (const other of pieces.filter((x) => x.col === 0 && x !== p)) {
                    other.floor = -99;
                    other.y = -999;
                }
                dropPiece(p);
                for (let i = 0; i < 400 && p.falling; i++) step(0.016);
                return p.segs.slice();
            });
            expect(segs).toEqual([false, false, false, false]);
        });

        test('an ingredient already on the plate cannot be dropped again', async ({ page }) => {
            const r = await page.evaluate(() => {
                startGame();
                const p = pieces[0];
                p.onPlate = true;
                score = 0;
                dropPiece(p);
                return { falling: p.falling, score };
            });
            expect(r.falling).toBe(false);
            expect(r.score).toBe(0);
        });
    });

    // -----------------------------------------------------------------------
    // Enemies
    // -----------------------------------------------------------------------
    test.describe('enemies', () => {
        test('spawnEnemy places an enemy on the requested floor', async ({ page }) => {
            const e = await page.evaluate(() => {
                startGame();
                enemies.length = 0;
                spawnEnemy(120, 3, 'hotdog');
                return { n: enemies.length, x: enemies[0].x, floor: enemies[0].floor, y: enemies[0].y };
            });
            expect(e.n).toBe(1);
            expect(e.x).toBe(120);
            expect(e.floor).toBe(3);
        });

        test('an enemy on the same floor walks toward the chef', async ({ page }) => {
            const r = await page.evaluate(() => {
                startGame();
                enemies.length = 0;
                setChef(500, 3);
                spawnEnemy(120, 3, 'hotdog');
                const before = enemies[0].x;
                for (let i = 0; i < 30; i++) step(0.016);
                return { before, after: enemies[0].x };
            });
            expect(r.after).toBeGreaterThan(r.before);
        });

        test('an enemy on another floor heads for a ladder', async ({ page }) => {
            const climbed = await page.evaluate(() => {
                startGame();
                enemies.length = 0;
                setChef(LADDER_X[1], 2);
                spawnEnemy(LADDER_X[1] + 6, 5, 'hotdog');
                const before = enemies[0].y;
                for (let i = 0; i < 400; i++) {
                    step(0.016);
                    if (enemies[0].y < before) return true;
                }
                return false;
            });
            expect(climbed).toBe(true);
        });

        test('touching an enemy costs a life', async ({ page }) => {
            const lives = await page.evaluate(() => {
                startGame();
                enemies.length = 0;
                setChef(300, 5);
                spawnEnemy(300, 5, 'hotdog');
                step(0.016);
                return lives;
            });
            expect(lives).toBe(2);
        });

        test('losing a life sends the chef back to the start', async ({ page }) => {
            const r = await page.evaluate(() => {
                startGame();
                enemies.length = 0;
                setChef(300, 5);
                spawnEnemy(300, 5, 'hotdog');
                step(0.016);
                return { x: chef.x, floor: chef.floor, startX: CHEF_START.x, startFloor: CHEF_START.floor };
            });
            expect(r.x).toBe(r.startX);
            expect(r.floor).toBe(r.startFloor);
        });

        test('losing the last life ends the game', async ({ page }) => {
            const s = await page.evaluate(() => {
                startGame();
                lives = 1;
                enemies.length = 0;
                setChef(300, 5);
                spawnEnemy(300, 5, 'hotdog');
                step(0.016);
                return state;
            });
            expect(s).toBe('over');
        });

        test('a stunned enemy stays put', async ({ page }) => {
            const r = await page.evaluate(() => {
                startGame();
                enemies.length = 0;
                setChef(500, 3);
                spawnEnemy(120, 3, 'hotdog');
                enemies[0].stun = 3;
                const before = enemies[0].x;
                for (let i = 0; i < 30; i++) step(0.016);
                return { before, after: enemies[0].x };
            });
            expect(r.after).toBe(r.before);
        });

        test('a falling ingredient squashes an enemy in its path', async ({ page }) => {
            const r = await page.evaluate(() => {
                startGame();
                enemies.length = 0;
                setChef(40, 0);
                const p = pieces.find((x) => x.col === 0 && x.floor === topFloorOf(0));
                for (const other of pieces.filter((x) => x.col === 0 && x !== p)) {
                    other.floor = -99;
                    other.y = -999;
                }
                spawnEnemy(p.x, p.floor + 1, 'hotdog');
                const victim = enemies[0];
                score = 0;
                dropPiece(p);
                for (let i = 0; i < 400 && p.falling; i++) step(0.016);
                return { gone: !enemies.includes(victim), score };
            });
            expect(r.gone).toBe(true);
            expect(r.score).toBeGreaterThanOrEqual(150); // 50 for the drop + 100 for the squash
        });

        test('squashed enemies come back after a delay', async ({ page }) => {
            const n = await page.evaluate(() => {
                startGame();
                enemies.length = 0;
                setChef(40, 0);
                const p = pieces.find((x) => x.col === 0 && x.floor === topFloorOf(0));
                for (const other of pieces.filter((x) => x.col === 0 && x !== p)) {
                    other.floor = -99;
                    other.y = -999;
                }
                spawnEnemy(p.x, p.floor + 1, 'hotdog');
                dropPiece(p);
                for (let i = 0; i < 300; i++) step(0.016);
                return enemies.length;
            });
            expect(n).toBeGreaterThan(0);
        });
    });

    // -----------------------------------------------------------------------
    // Pepper
    // -----------------------------------------------------------------------
    test.describe('pepper', () => {
        test('firing pepper uses one shaker', async ({ page }) => {
            const p = await page.evaluate(() => {
                startGame();
                firePepper();
                return peppers;
            });
            expect(p).toBe(4);
        });

        test('pepper stuns an enemy in front of the chef', async ({ page }) => {
            const stun = await page.evaluate(() => {
                startGame();
                enemies.length = 0;
                setChef(300, 5);
                chef.facing = 1;
                spawnEnemy(340, 5, 'hotdog');
                firePepper();
                step(0.016);
                return enemies[0].stun;
            });
            expect(stun).toBeGreaterThan(0);
        });

        test('pepper misses an enemy behind the chef', async ({ page }) => {
            const stun = await page.evaluate(() => {
                startGame();
                enemies.length = 0;
                setChef(300, 5);
                chef.facing = 1;
                spawnEnemy(240, 5, 'hotdog');
                firePepper();
                step(0.016);
                return enemies[0].stun;
            });
            expect(stun).toBe(0);
        });

        test('an empty shaker fires nothing', async ({ page }) => {
            const r = await page.evaluate(() => {
                startGame();
                peppers = 0;
                const fired = firePepper();
                return { fired, peppers, clouds: clouds.length };
            });
            expect(r.fired).toBe(false);
            expect(r.peppers).toBe(0);
            expect(r.clouds).toBe(0);
        });

        test('Space throws pepper while the game is running', async ({ page }) => {
            await page.evaluate(() => startGame());
            await page.keyboard.press('Space');
            expect(await page.evaluate(() => peppers)).toBe(4);
        });
    });

    // -----------------------------------------------------------------------
    // Levels
    // -----------------------------------------------------------------------
    test.describe('levels', () => {
        test('plating every ingredient clears the level', async ({ page }) => {
            const r = await page.evaluate(() => {
                startGame();
                enemies.length = 0; // clear the board so the run is about the burgers
                for (let guard = 0; guard < 40 && level === 1; guard++) {
                    for (const p of pieces) {
                        if (!p.onPlate && !p.falling) dropPiece(p);
                    }
                    for (let i = 0; i < 200; i++) step(0.016);
                }
                return { level, score, pieces: pieces.length, onPlate: pieces.filter((p) => p.onPlate).length };
            });
            expect(r.level).toBe(2);
            expect(r.score).toBeGreaterThan(800);
            expect(r.pieces).toBe(16);
            expect(r.onPlate).toBe(0);
        });

        test('enemies get faster on later levels', async ({ page }) => {
            const r = await page.evaluate(() => {
                startGame();
                const one = enemySpeed();
                level = 4;
                return { one, four: enemySpeed() };
            });
            expect(r.four).toBeGreaterThan(r.one);
        });

        test('a new level restocks the pepper shakers', async ({ page }) => {
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
    // Pause, game over, best score
    // -----------------------------------------------------------------------
    test.describe('pause, game over and best score', () => {
        test('pausing freezes falling ingredients', async ({ page }) => {
            const r = await page.evaluate(() => {
                startGame();
                const p = pieces.find((x) => x.col === 0 && x.floor === topFloorOf(0));
                dropPiece(p);
                togglePause();
                const before = p.y;
                for (let i = 0; i < 20; i++) step(0.016);
                return { before, after: p.y, state };
            });
            expect(r.state).toBe('paused');
            expect(r.after).toBe(r.before);
        });

        test('resuming lets them fall again', async ({ page }) => {
            const moved = await page.evaluate(() => {
                startGame();
                const p = pieces.find((x) => x.col === 0 && x.floor === topFloorOf(0));
                dropPiece(p);
                togglePause();
                togglePause();
                const before = p.y;
                for (let i = 0; i < 10; i++) step(0.016);
                return p.y > before;
            });
            expect(moved).toBe(true);
        });

        test('game over shows the overlay with Play Again', async ({ page }) => {
            await page.evaluate(() => { startGame(); endGame(); });
            await expect(page.locator('#overlay')).toHaveClass(/visible/);
            await expect(page.locator('#btn-start')).toHaveText('Play Again');
        });

        test('best score updates when beaten', async ({ page }) => {
            await page.evaluate(() => {
                startGame();
                score = 1730;
                endGame();
            });
            await expect(page.locator('#best')).toHaveText('1730');
            const stored = await page.evaluate(() => window.localStorage.getItem('burgertime-best'));
            expect(parseInt(stored, 10)).toBe(1730);
        });

        test('best score is not lowered by a worse run', async ({ page }) => {
            await page.evaluate(() => window.localStorage.setItem('burgertime-best', '9000'));
            await page.reload();
            await page.evaluate(() => { startGame(); score = 10; endGame(); });
            await expect(page.locator('#best')).toHaveText('9000');
        });

        test('restarting after game over resets the board', async ({ page }) => {
            const r = await page.evaluate(() => {
                startGame();
                score = 4000;
                level = 6;
                lives = 1;
                peppers = 0;
                endGame();
                startGame();
                return { score, level, lives, peppers, state, onPlate: pieces.filter((p) => p.onPlate).length };
            });
            expect(r).toEqual({ score: 0, level: 1, lives: 3, peppers: 5, state: 'running', onPlate: 0 });
        });
    });
});
