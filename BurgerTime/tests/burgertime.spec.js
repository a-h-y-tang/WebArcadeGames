const { test, expect } = require('@playwright/test');
const path = require('path');
const { pathToFileURL } = require('url');

const GAME_URL = pathToFileURL(path.resolve(__dirname, '../index.html')).href;

// Advance the simulation by `seconds` in 1/50s slices, the way the real frame
// loop does, so tests exercise the same code path as gameplay.
const RUN = (seconds) => `(() => {
    const slices = Math.round(${seconds} * 50);
    for (let i = 0; i < slices; i++) step(0.02);
})()`;

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
            await expect(page.locator('#overlay-sub')).toContainText(/start|enter|space/i);
        });

        test('canvas matches the tile lattice', async ({ page }) => {
            const canvas = page.locator('#canvas');
            await expect(canvas).toHaveAttribute('width', '630');
            await expect(canvas).toHaveAttribute('height', '480');
        });

        test('score, level, lives and peppers are shown', async ({ page }) => {
            await expect(page.locator('#score')).toHaveText('0');
            await expect(page.locator('#level')).toHaveText('1');
            await expect(page.locator('#lives')).toHaveText('3');
            await expect(page.locator('#peppers')).toHaveText('5');
        });

        test('state is idle before starting', async ({ page }) => {
            expect(await page.evaluate(() => state)).toBe('idle');
        });

        test('no enemies before starting', async ({ page }) => {
            expect(await page.evaluate(() => enemies.length)).toBe(0);
        });

        test('step() does nothing while idle', async ({ page }) => {
            const moved = await page.evaluate(() => {
                const x = chef.x, y = chef.y;
                moveChef(1, 0);
                for (let i = 0; i < 50; i++) step(0.02);
                return chef.x !== x || chef.y !== y;
            });
            expect(moved).toBe(false);
        });

        test('best score loads from localStorage', async ({ page }) => {
            await page.evaluate(() => window.localStorage.setItem('burgertime-best', '4200'));
            await page.reload();
            await expect(page.locator('#best')).toHaveText('4200');
        });
    });

    // -----------------------------------------------------------------------
    // Board layout
    // -----------------------------------------------------------------------
    test.describe('board layout', () => {
        test('five platforms and five ladders form the lattice', async ({ page }) => {
            const geom = await page.evaluate(() => ({
                floors: FLOOR_ROWS, ladders: LADDER_COLS, tile: TILE, plate: PLATE_ROW,
            }));
            expect(geom.floors).toEqual([2, 5, 8, 11, 14]);
            expect(geom.ladders).toEqual([0, 5, 10, 15, 20]);
            expect(geom.tile).toBe(30);
            expect(geom.plate).toBe(14);
        });

        test('floorY and ladderX map the lattice to pixels', async ({ page }) => {
            const p = await page.evaluate(() => ({ f: floorY(5), l: ladderX(10) }));
            expect(p.f).toBe(150);
            expect(p.l).toBe(315);
        });

        test('four burgers of four ingredients each', async ({ page }) => {
            const info = await page.evaluate(() => {
                startGame();
                return {
                    total: ingredients.length,
                    burgers: BURGER_COLS.length,
                    perBurger: BURGER_COLS.map((_, i) => ingredients.filter((g) => g.burger === i).length),
                };
            });
            expect(info.burgers).toBe(4);
            expect(info.total).toBe(16);
            expect(info.perBurger).toEqual([4, 4, 4, 4]);
        });

        test('each burger starts spread across rows 2, 5, 8 and 11', async ({ page }) => {
            const rows = await page.evaluate(() => {
                startGame();
                return ingredients.filter((g) => g.burger === 0).map((g) => g.row).sort((a, b) => a - b);
            });
            expect(rows).toEqual([2, 5, 8, 11]);
        });

        test('ingredients rest on their platform walk line', async ({ page }) => {
            const ok = await page.evaluate(() => {
                startGame();
                return ingredients.every((g) => g.y === floorY(g.row) && g.state === 'rest');
            });
            expect(ok).toBe(true);
        });

        test('ingredients are four tiles wide and untrodden at the start', async ({ page }) => {
            const ok = await page.evaluate(() => {
                startGame();
                return ingredients.every((g) => g.segs.length === INGREDIENT_TILES && g.segs.every((s) => !s));
            });
            expect(ok).toBe(true);
        });

        test('plates start empty', async ({ page }) => {
            const counts = await page.evaluate(() => { startGame(); return plates.map((p) => p.length); });
            expect(counts).toEqual([0, 0, 0, 0]);
        });
    });

    // -----------------------------------------------------------------------
    // Starting the game
    // -----------------------------------------------------------------------
    test.describe('starting', () => {
        test('Enter starts the game', async ({ page }) => {
            await page.keyboard.press('Enter');
            expect(await page.evaluate(() => state)).toBe('running');
            await expect(page.locator('#overlay')).not.toHaveClass(/visible/);
        });

        test('the Start button starts the game', async ({ page }) => {
            await page.locator('#btn-start').click();
            expect(await page.evaluate(() => state)).toBe('running');
        });

        test('a new game has 3 lives, 5 peppers, level 1 and no score', async ({ page }) => {
            const s = await page.evaluate(() => { startGame(); return { lives, peppers, level, score }; });
            expect(s).toEqual({ lives: 3, peppers: 5, level: 1, score: 0 });
        });

        test('the chef starts on the bottom platform', async ({ page }) => {
            const c = await page.evaluate(() => { startGame(); return { y: chef.y, plate: floorY(PLATE_ROW) }; });
            expect(c.y).toBe(c.plate);
        });

        test('three enemies spawn on level 1', async ({ page }) => {
            expect(await page.evaluate(() => { startGame(); return enemies.length; })).toBe(3);
        });

        test('enemies spawn on the lattice, away from the chef', async ({ page }) => {
            const ok = await page.evaluate(() => {
                startGame();
                return enemies.every((e) => FLOOR_ROWS.some((r) => Math.abs(floorY(r) - e.y) < 0.001)
                    && Math.hypot(e.x - chef.x, e.y - chef.y) > TILE * 3);
            });
            expect(ok).toBe(true);
        });
    });

    // -----------------------------------------------------------------------
    // Chef movement
    // -----------------------------------------------------------------------
    test.describe('chef movement', () => {
        test('running right increases x', async ({ page }) => {
            const d = await page.evaluate(() => {
                startGame();
                const before = chef.x;
                moveChef(1, 0);
                for (let i = 0; i < 20; i++) step(0.02);
                return chef.x - before;
            });
            expect(d).toBeGreaterThan(0);
        });

        test('running left decreases x', async ({ page }) => {
            const d = await page.evaluate(() => {
                startGame();
                const before = chef.x;
                moveChef(-1, 0);
                for (let i = 0; i < 20; i++) step(0.02);
                return chef.x - before;
            });
            expect(d).toBeLessThan(0);
        });

        test('running updates the facing direction', async ({ page }) => {
            const f = await page.evaluate(() => {
                startGame();
                moveChef(-1, 0);
                for (let i = 0; i < 5; i++) step(0.02);
                const left = chef.facing;
                moveChef(1, 0);
                for (let i = 0; i < 5; i++) step(0.02);
                return { left, right: chef.facing };
            });
            expect(f.left).toBe(-1);
            expect(f.right).toBe(1);
        });

        test('the chef stops at the left ladder', async ({ page }) => {
            const x = await page.evaluate(() => {
                startGame();
                enemies.length = 0;
                moveChef(-1, 0);
                for (let i = 0; i < 600; i++) step(0.02);
                return chef.x;
            });
            expect(x).toBeCloseTo(15, 3);
        });

        test('the chef stops at the right ladder', async ({ page }) => {
            const x = await page.evaluate(() => {
                startGame();
                enemies.length = 0;
                moveChef(1, 0);
                for (let i = 0; i < 600; i++) step(0.02);
                return chef.x;
            });
            expect(x).toBeCloseTo(615, 3);
        });

        test('the chef climbs when standing on a ladder', async ({ page }) => {
            const d = await page.evaluate(() => {
                startGame();
                chef.x = ladderX(10);
                const before = chef.y;
                moveChef(0, -1);
                for (let i = 0; i < 30; i++) step(0.02);
                return before - chef.y;
            });
            expect(d).toBeGreaterThan(0);
        });

        test('the chef cannot climb away from a ladder', async ({ page }) => {
            const d = await page.evaluate(() => {
                startGame();
                chef.x = ladderX(10) + TILE * 2;
                const before = chef.y;
                moveChef(0, -1);
                for (let i = 0; i < 30; i++) step(0.02);
                return before - chef.y;
            });
            expect(d).toBe(0);
        });

        test('climbing snaps the chef onto the ladder centre', async ({ page }) => {
            const x = await page.evaluate(() => {
                startGame();
                chef.x = ladderX(10) + 8;
                moveChef(0, -1);
                for (let i = 0; i < 10; i++) step(0.02);
                return chef.x;
            });
            expect(x).toBeCloseTo(315, 3);
        });

        test('the chef cannot climb above the top platform', async ({ page }) => {
            const y = await page.evaluate(() => {
                startGame();
                enemies.length = 0;
                chef.x = ladderX(10);
                moveChef(0, -1);
                for (let i = 0; i < 600; i++) step(0.02);
                return chef.y;
            });
            expect(y).toBeCloseTo(60, 3);
        });

        test('the chef cannot climb below the plate platform', async ({ page }) => {
            const y = await page.evaluate(() => {
                startGame();
                enemies.length = 0;
                chef.x = ladderX(10);
                moveChef(0, 1);
                for (let i = 0; i < 600; i++) step(0.02);
                return chef.y;
            });
            expect(y).toBeCloseTo(420, 3);
        });

        test('walking snaps the chef onto the platform walk line', async ({ page }) => {
            const y = await page.evaluate(() => {
                startGame();
                chef.x = ladderX(10);
                chef.y = floorY(11) + 4;   // just under a walk line
                moveChef(1, 0);
                for (let i = 0; i < 5; i++) step(0.02);
                return chef.y;
            });
            expect(y).toBeCloseTo(330, 3);
        });

        test('arrow keys drive the chef', async ({ page }) => {
            await page.evaluate(() => startGame());
            await page.keyboard.down('ArrowRight');
            await page.waitForTimeout(150);
            await page.keyboard.up('ArrowRight');
            const moved = await page.evaluate(() => chef.x > ladderX(10));
            expect(moved).toBe(true);
        });
    });

    // -----------------------------------------------------------------------
    // Ingredients
    // -----------------------------------------------------------------------
    test.describe('ingredients', () => {
        test('standing on a segment treads it', async ({ page }) => {
            const segs = await page.evaluate(() => {
                startGame();
                const g = ingredients.find((i) => i.burger === 0 && i.row === 11);
                chef.y = floorY(g.row);
                chef.x = g.col * TILE + TILE / 2;
                step(0.02);
                return g.segs.slice();
            });
            expect(segs[0]).toBe(true);
            expect(segs.slice(1)).toEqual([false, false, false]);
        });

        test('an ingredient on another platform is not trodden', async ({ page }) => {
            const trodden = await page.evaluate(() => {
                startGame();
                const g = ingredients.find((i) => i.burger === 0 && i.row === 11);
                chef.y = floorY(8);
                chef.x = g.col * TILE + TILE / 2;
                step(0.02);
                return g.segs.some(Boolean);
            });
            expect(trodden).toBe(false);
        });

        test('walking the full length knocks the ingredient down', async ({ page }) => {
            const res = await page.evaluate(() => {
                startGame();
                enemies.length = 0;
                const g = ingredients.find((i) => i.burger === 0 && i.row === 11);
                chef.y = floorY(g.row);
                chef.x = g.col * TILE;
                moveChef(1, 0);
                for (let i = 0; i < 120; i++) step(0.02);
                return { row: g.row, onPlate: g.onPlate, plated: plates[0].length };
            });
            expect(res.row).toBe(14);
            expect(res.onPlate).toBe(true);
            expect(res.plated).toBe(1);
        });

        test('a fully trodden ingredient starts falling', async ({ page }) => {
            const s = await page.evaluate(() => {
                startGame();
                const g = ingredients.find((i) => i.burger === 1 && i.row === 8);
                chef.y = floorY(g.row);
                for (let s = 0; s < INGREDIENT_TILES; s++) {
                    chef.x = g.col * TILE + s * TILE + TILE / 2;
                    step(0.02);
                }
                return g.state;
            });
            expect(s).toBe('falling');
        });

        test('a falling ingredient lands exactly one platform lower', async ({ page }) => {
            const res = await page.evaluate(() => {
                startGame();
                enemies.length = 0;
                const g = ingredients.find((i) => i.burger === 2 && i.row === 2);
                startFall(g);
                for (let i = 0; i < 150; i++) step(0.02);
                return { row: g.row, y: g.y, state: g.state };
            });
            expect(res.row).toBe(5);
            expect(res.state).toBe('rest');
            expect(res.y).toBe(150);
        });

        test('landing clears the trodden segments so it must be walked again', async ({ page }) => {
            const segs = await page.evaluate(() => {
                startGame();
                enemies.length = 0;
                const g = ingredients.find((i) => i.burger === 2 && i.row === 2);
                startFall(g);
                for (let i = 0; i < 150; i++) step(0.02);
                return g.segs.slice();
            });
            expect(segs).toEqual([false, false, false, false]);
        });

        test('landing on a resting ingredient knocks that one down too', async ({ page }) => {
            const res = await page.evaluate(() => {
                startGame();
                enemies.length = 0;
                const top = ingredients.find((i) => i.burger === 3 && i.row === 2);
                const next = ingredients.find((i) => i.burger === 3 && i.row === 5);
                startFall(top);
                for (let i = 0; i < 250; i++) step(0.02);
                return { top: top.row, next: next.row };
            });
            expect(res.top).toBe(5);
            expect(res.next).toBe(8);
        });

        test('a knock-on chain moves the whole column down one level', async ({ page }) => {
            const rows = await page.evaluate(() => {
                startGame();
                enemies.length = 0;
                const top = ingredients.find((i) => i.burger === 0 && i.row === 2);
                startFall(top);
                for (let i = 0; i < 400; i++) step(0.02);
                return {
                    rows: ingredients.filter((i) => i.burger === 0).map((i) => i.row).sort((a, b) => a - b),
                    plate: plates[0].length,
                };
            });
            expect(rows.rows).toEqual([5, 8, 11, 14]);
            expect(rows.plate).toBe(1);
        });

        test('an ingredient reaching the plate stacks and stays put', async ({ page }) => {
            const res = await page.evaluate(() => {
                startGame();
                enemies.length = 0;
                const bottom = ingredients.find((i) => i.burger === 0 && i.row === 11);
                startFall(bottom);
                for (let i = 0; i < 150; i++) step(0.02);
                const first = { onPlate: bottom.onPlate, y: bottom.y, stack: plates[0].length };
                startFall(bottom);                      // already plated — must be ignored
                for (let i = 0; i < 100; i++) step(0.02);
                return { first, after: { onPlate: bottom.onPlate, y: bottom.y, stack: plates[0].length } };
            });
            expect(res.first.onPlate).toBe(true);
            expect(res.first.stack).toBe(1);
            expect(res.after).toEqual({ onPlate: true, y: res.first.y, stack: 1 });
        });

        test('plated ingredients stack upward from the plate', async ({ page }) => {
            const ys = await page.evaluate(() => {
                startGame();
                enemies.length = 0;
                for (let round = 0; round < 2; round++) {
                    ingredients.filter((i) => i.burger === 0 && i.state === 'rest' && !i.onPlate)
                        .forEach(startFall);
                    for (let i = 0; i < 200; i++) step(0.02);
                }
                return plates[0].map((g) => g.y);
            });
            expect(ys.length).toBe(2);
            expect(ys[1]).toBeLessThan(ys[0]);
            expect(ys[0] - ys[1]).toBeCloseTo(10, 3);
        });

        test('landing an ingredient scores points', async ({ page }) => {
            const gained = await page.evaluate(() => {
                startGame();
                enemies.length = 0;
                const before = score;
                startFall(ingredients.find((i) => i.burger === 1 && i.row === 2));
                for (let i = 0; i < 150; i++) step(0.02);
                return score - before;
            });
            expect(gained).toBeGreaterThanOrEqual(50);
        });
    });

    // -----------------------------------------------------------------------
    // Building burgers / clearing levels
    // -----------------------------------------------------------------------
    test.describe('burgers and levels', () => {
        // Knock every resting ingredient down one level, repeatedly, until the
        // whole board has reached the plates.
        const CLEAR_BOARD = `(() => {
            enemies.length = 0;
            for (let round = 0; round < 6; round++) {
                ingredients.filter((g) => g.state === 'rest' && !g.onPlate).forEach(startFall);
                for (let i = 0; i < 200; i++) step(0.02);
            }
        })()`;

        test('a burger is complete when its four ingredients are plated', async ({ page }) => {
            const res = await page.evaluate(`(() => {
                startGame();
                ${CLEAR_BOARD};
                return { complete: burgerComplete(0), stack: plates[0].length };
            })()`);
            expect(res.stack).toBe(4);
            expect(res.complete).toBe(true);
        });

        test('completing every burger clears the level', async ({ page }) => {
            const res = await page.evaluate(`(() => {
                startGame();
                ${CLEAR_BOARD};
                return { all: allBurgersComplete(), state, score };
            })()`);
            expect(res.all).toBe(true);
            expect(res.state).toBe('levelclear');
            expect(res.score).toBeGreaterThan(1000);
        });

        test('the next level rebuilds the board and speeds the enemies up', async ({ page }) => {
            const res = await page.evaluate(`(() => {
                startGame();
                const slow = enemySpeed();
                ${CLEAR_BOARD};
                nextLevel();
                return {
                    level, state, slow, fast: enemySpeed(),
                    plated: plates.map((p) => p.length),
                    resting: ingredients.filter((g) => g.state === 'rest' && !g.onPlate).length,
                    enemies: enemies.length,
                    peppers,
                };
            })()`);
            expect(res.level).toBe(2);
            expect(res.state).toBe('running');
            expect(res.plated).toEqual([0, 0, 0, 0]);
            expect(res.resting).toBe(16);
            expect(res.fast).toBeGreaterThan(res.slow);
            expect(res.enemies).toBe(4);
            expect(res.peppers).toBe(5);
        });

        test('Space advances past the level-clear overlay', async ({ page }) => {
            await page.evaluate(`(() => { startGame(); ${CLEAR_BOARD}; })()`);
            await expect(page.locator('#overlay')).toHaveClass(/visible/);
            await page.keyboard.press('Space');
            expect(await page.evaluate(() => ({ state, level }))).toEqual({ state: 'running', level: 2 });
        });
    });

    // -----------------------------------------------------------------------
    // Enemies
    // -----------------------------------------------------------------------
    test.describe('enemies', () => {
        test('enemies chase the chef', async ({ page }) => {
            const res = await page.evaluate(() => {
                startGame();
                enemyRandomChance = 0;
                enemies.length = 1;
                const e = enemies[0];
                e.x = ladderX(0); e.y = floorY(2); e.dx = 0; e.dy = 0;
                chef.x = ladderX(20); chef.y = floorY(2);
                const before = Math.hypot(e.x - chef.x, e.y - chef.y);
                for (let i = 0; i < 100; i++) step(0.02);
                return { before, after: Math.hypot(e.x - chef.x, e.y - chef.y) };
            });
            expect(res.after).toBeLessThan(res.before);
        });

        test('enemies stay on the lattice', async ({ page }) => {
            const ok = await page.evaluate(() => {
                startGame();
                for (let i = 0; i < 300; i++) step(0.02);
                return enemies.every((e) => {
                    const onFloor = FLOOR_ROWS.some((r) => Math.abs(floorY(r) - e.y) < 0.001);
                    const onLadder = LADDER_COLS.some((c) => Math.abs(ladderX(c) - e.x) < 0.001);
                    return (onFloor || onLadder)
                        && e.x >= ladderX(0) - 0.001 && e.x <= ladderX(COLS - 1) + 0.001
                        && e.y >= floorY(2) - 0.001 && e.y <= floorY(PLATE_ROW) + 0.001;
                });
            });
            expect(ok).toBe(true);
        });

        test('touching an enemy costs a life and resets positions', async ({ page }) => {
            const res = await page.evaluate(() => {
                startGame();
                const startX = chef.x, startY = chef.y;
                chef.x = ladderX(5); chef.y = floorY(8);
                enemies[0].x = chef.x; enemies[0].y = chef.y;
                step(0.02);
                return { lives, state, backHome: chef.x === startX && chef.y === startY };
            });
            expect(res.lives).toBe(2);
            expect(res.state).toBe('running');
            expect(res.backHome).toBe(true);
        });

        test('losing the last life ends the game', async ({ page }) => {
            const res = await page.evaluate(() => {
                startGame();
                lives = 1;
                enemies[0].x = chef.x; enemies[0].y = chef.y;
                step(0.02);
                return { lives, state };
            });
            expect(res.lives).toBe(0);
            expect(res.state).toBe('over');
            await expect(page.locator('#overlay')).toHaveClass(/visible/);
        });

        test('losing a life keeps the board as it was', async ({ page }) => {
            const res = await page.evaluate(() => {
                startGame();
                enemies.length = 1;
                enemies[0].stun = 99;             // park the enemy while the board settles
                const g = ingredients.find((i) => i.burger === 0 && i.row === 11);
                startFall(g);
                for (let i = 0; i < 150; i++) step(0.02);
                const plated = plates[0].length;
                chef.x = ladderX(5); chef.y = floorY(8);
                enemies[0].x = chef.x; enemies[0].y = chef.y; enemies[0].stun = 0;
                step(0.02);
                return { plated, after: plates[0].length, lives };
            });
            expect(res.plated).toBe(1);
            expect(res.after).toBe(1);
            expect(res.lives).toBe(2);
        });

        test('a stunned enemy stands still', async ({ page }) => {
            const res = await page.evaluate(() => {
                startGame();
                enemies.length = 1;
                const e = enemies[0];
                e.stun = 2;
                const before = { x: e.x, y: e.y };
                for (let i = 0; i < 25; i++) step(0.02);
                return { before, after: { x: e.x, y: e.y }, stun: e.stun };
            });
            expect(res.after).toEqual(res.before);
            expect(res.stun).toBeLessThan(2);
        });

        test('a stun wears off', async ({ page }) => {
            const stun = await page.evaluate(() => {
                startGame();
                enemies[0].stun = 0.5;
                for (let i = 0; i < 60; i++) step(0.02);
                return enemies[0].stun;
            });
            expect(stun).toBe(0);
        });

        test('a falling ingredient squashes an enemy underneath it', async ({ page }) => {
            const res = await page.evaluate(() => {
                startGame();
                enemies.length = 1;
                const g = ingredients.find((i) => i.burger === 1 && i.row === 8);
                const e = enemies[0];
                e.x = g.col * TILE + TILE; e.y = floorY(11); e.stun = 99;
                const before = score;
                startFall(g);
                for (let i = 0; i < 150; i++) step(0.02);
                return { count: enemies.length, gained: score - before };
            });
            expect(res.count).toBe(0);
            expect(res.gained).toBeGreaterThanOrEqual(150);
        });

        test('a squashed enemy respawns later', async ({ page }) => {
            const res = await page.evaluate(() => {
                startGame();
                enemies.length = 1;
                const g = ingredients.find((i) => i.burger === 1 && i.row === 8);
                const e = enemies[0];
                e.x = g.col * TILE + TILE; e.y = floorY(11); e.stun = 99;
                startFall(g);
                for (let i = 0; i < 150; i++) step(0.02);
                const squashed = enemies.length;
                for (let i = 0; i < 400; i++) step(0.02);
                return { squashed, back: enemies.length };
            });
            expect(res.squashed).toBe(0);
            expect(res.back).toBe(1);
        });

        test('a falling ingredient is harmless to the chef', async ({ page }) => {
            const res = await page.evaluate(() => {
                startGame();
                enemies.length = 0;
                const g = ingredients.find((i) => i.burger === 1 && i.row === 8);
                chef.x = g.col * TILE + TILE; chef.y = floorY(11);
                startFall(g);
                for (let i = 0; i < 150; i++) step(0.02);
                return { lives, state };
            });
            expect(res.lives).toBe(3);
            expect(res.state).toBe('running');
        });
    });

    // -----------------------------------------------------------------------
    // Pepper
    // -----------------------------------------------------------------------
    test.describe('pepper', () => {
        test('throwing pepper spends one', async ({ page }) => {
            const res = await page.evaluate(() => {
                startGame();
                const used = usePepper();
                return { used, peppers };
            });
            expect(res.used).toBe(true);
            expect(res.peppers).toBe(4);
        });

        test('pepper stuns an enemy in front of the chef', async ({ page }) => {
            const stun = await page.evaluate(() => {
                startGame();
                enemies.length = 1;
                chef.x = ladderX(10); chef.y = floorY(PLATE_ROW);
                moveChef(1, 0);
                step(0.02);
                enemies[0].x = chef.x + TILE; enemies[0].y = chef.y;
                usePepper();
                step(0.02);
                return enemies[0].stun;
            });
            expect(stun).toBeGreaterThan(0);
        });

        test('pepper does not reach behind the chef', async ({ page }) => {
            const stun = await page.evaluate(() => {
                startGame();
                enemies.length = 1;
                chef.x = ladderX(10); chef.y = floorY(PLATE_ROW);
                moveChef(1, 0);
                step(0.02);
                enemies[0].x = chef.x - TILE * 2; enemies[0].y = chef.y;
                usePepper();
                step(0.02);
                return enemies[0].stun;
            });
            expect(stun).toBe(0);
        });

        test('pepper runs out', async ({ page }) => {
            const res = await page.evaluate(() => {
                startGame();
                for (let i = 0; i < START_PEPPERS; i++) usePepper();
                return { peppers, used: usePepper() };
            });
            expect(res.peppers).toBe(0);
            expect(res.used).toBe(false);
        });

        test('Space throws pepper while running', async ({ page }) => {
            await page.evaluate(() => startGame());
            await page.keyboard.press('Space');
            await expect(page.locator('#peppers')).toHaveText('4');
        });
    });

    // -----------------------------------------------------------------------
    // Pausing, restarting, HUD
    // -----------------------------------------------------------------------
    test.describe('game flow', () => {
        test('P pauses and resumes', async ({ page }) => {
            await page.evaluate(() => startGame());
            await page.keyboard.press('p');
            expect(await page.evaluate(() => state)).toBe('paused');
            await page.keyboard.press('p');
            expect(await page.evaluate(() => state)).toBe('running');
        });

        test('a paused game does not advance', async ({ page }) => {
            const moved = await page.evaluate(() => {
                startGame();
                togglePause();
                const x = chef.x;
                moveChef(1, 0);
                for (let i = 0; i < 50; i++) step(0.02);
                return chef.x !== x;
            });
            expect(moved).toBe(false);
        });

        test('the HUD tracks the game state', async ({ page }) => {
            await page.evaluate(() => {
                startGame();
                score = 1234; lives = 2; level = 3; peppers = 1;
                updateHud();
            });
            await expect(page.locator('#score')).toHaveText('1234');
            await expect(page.locator('#lives')).toHaveText('2');
            await expect(page.locator('#level')).toHaveText('3');
            await expect(page.locator('#peppers')).toHaveText('1');
        });

        test('game over records a new best score', async ({ page }) => {
            const best = await page.evaluate(() => {
                startGame();
                score = 7777;
                lives = 1;
                enemies[0].x = chef.x; enemies[0].y = chef.y;
                step(0.02);
                return window.localStorage.getItem('burgertime-best');
            });
            expect(best).toBe('7777');
            await expect(page.locator('#best')).toHaveText('7777');
        });

        test('restarting after game over resets the board', async ({ page }) => {
            const res = await page.evaluate(() => {
                startGame();
                score = 500;
                lives = 1;
                enemies[0].x = chef.x; enemies[0].y = chef.y;
                step(0.02);
                startGame();
                return {
                    state, score, lives, level,
                    plated: plates.map((p) => p.length),
                    resting: ingredients.filter((g) => g.state === 'rest').length,
                };
            });
            expect(res).toEqual({
                state: 'running', score: 0, lives: 3, level: 1,
                plated: [0, 0, 0, 0], resting: 16,
            });
        });

        test('the simulation is frame-rate independent', async ({ page }) => {
            const res = await page.evaluate(() => {
                startGame();
                enemies.length = 0;
                chef.x = ladderX(10);
                moveChef(1, 0);
                for (let i = 0; i < 100; i++) step(0.01);
                const fine = chef.x;
                startGame();
                enemies.length = 0;
                chef.x = ladderX(10);
                moveChef(1, 0);
                for (let i = 0; i < 20; i++) step(0.05);
                return { fine, coarse: chef.x };
            });
            expect(res.coarse).toBeCloseTo(res.fine, 3);
        });

        test('a long unattended run stays stable', async ({ page }) => {
            const res = await page.evaluate(`(() => {
                startGame();
                ${RUN(20)};
                return { state, lives, ok: ingredients.every((g) => isFinite(g.y)) };
            })()`);
            expect(res.ok).toBe(true);
            expect(['running', 'over', 'levelclear']).toContain(res.state);
        });

        test('the canvas renders without errors', async ({ page }) => {
            const errors = [];
            page.on('pageerror', (e) => errors.push(e.message));
            await page.evaluate(() => { startGame(); draw(); });
            await page.waitForTimeout(200);
            expect(errors).toEqual([]);
        });
    });
});
