const { test, expect } = require('@playwright/test');
const path = require('path');
const { pathToFileURL } = require('url');

const GAME_URL = pathToFileURL(path.resolve(__dirname, '../index.html')).href;

// Boot the page and switch off the requestAnimationFrame driver so every test
// advances the simulation itself through `step(dt)`. That keeps the assertions
// deterministic instead of racing the browser's frame clock.
async function boot(page) {
    await page.goto(GAME_URL);
    await page.evaluate(() => {
        AUTO_STEP = false;
        // Knock every ingredient of one burger down until it is on its plate,
        // the way a player would: push what is loose, let it settle, repeat.
        window.buryBurger = (burgerIndex) => {
            for (let round = 0; round < 20 && state === 'running'; round++) {
                const mine = pieces.filter((p) => p.burger === burgerIndex);
                if (mine.every((p) => p.stacked)) return;
                mine.filter((p) => !p.stacked && !p.falling).forEach((p) => dropPiece(p));
                for (let i = 0; i < 900 && state === 'running'; i++) {
                    step(1 / 60);
                    if (!pieces.some((p) => p.falling)) break;
                }
            }
        };
    });
}

// Start a game with the enemies removed. Movement and ingredient-physics tests
// simulate many seconds at a time, and a wandering hot dog would otherwise
// bump into the (stationary) chef and reset the board mid-assertion.
async function startClean(page) {
    await page.evaluate(() => { startGame(); enemies.length = 0; });
}

// Advance the simulation by `seconds` in fixed 1/60s slices.
async function advance(page, seconds) {
    await page.evaluate((secs) => {
        const dt = 1 / 60;
        for (let i = 0; i < Math.round(secs / dt); i++) step(dt);
    }, seconds);
}

test.describe('BurgerTime', () => {
    test.beforeEach(async ({ page }) => {
        await boot(page);
    });

    // -----------------------------------------------------------------------
    // Initial / idle state
    // -----------------------------------------------------------------------
    test.describe('initial state', () => {
        test('page title is BurgerTime', async ({ page }) => {
            await expect(page).toHaveTitle('BurgerTime');
        });

        test('start overlay is visible and prompts the player', async ({ page }) => {
            await expect(page.locator('#overlay')).toHaveClass(/visible/);
            await expect(page.locator('#overlay-sub')).toContainText(/space|start/i);
        });

        test('state is idle before starting', async ({ page }) => {
            expect(await page.evaluate(() => state)).toBe('idle');
        });

        test('canvas matches the world size', async ({ page }) => {
            const size = await page.evaluate(() => ({
                w: CANVAS_W, h: CANVAS_H, cols: COLS, rows: ROWS, tile: TILE,
            }));
            const canvas = page.locator('#canvas');
            await expect(canvas).toHaveAttribute('width', String(size.w));
            await expect(canvas).toHaveAttribute('height', String(size.h));
            expect(size.w).toBe(size.cols * size.tile);
            expect(size.h).toBe(size.rows * size.tile);
        });

        test('hud shows the starting score, level, lives and peppers', async ({ page }) => {
            await expect(page.locator('#score')).toHaveText('0');
            await expect(page.locator('#level')).toHaveText('1');
            await expect(page.locator('#lives')).toHaveText('3');
            await expect(page.locator('#peppers')).toHaveText('5');
        });

        test('best score is read from localStorage', async ({ page }) => {
            await page.evaluate(() => window.localStorage.setItem('burgertime-best', '4200'));
            await page.reload();
            await expect(page.locator('#best')).toHaveText('4200');
        });

        test('no enemies exist before starting', async ({ page }) => {
            expect(await page.evaluate(() => enemies.length)).toBe(0);
        });
    });

    // -----------------------------------------------------------------------
    // Level geometry
    // -----------------------------------------------------------------------
    test.describe('level layout', () => {
        test('there are five walkable floors and a plate row below them', async ({ page }) => {
            const geo = await page.evaluate(() => ({
                floors: FLOOR_ROWS.slice(),
                plate: PLATE_ROW,
            }));
            expect(geo.floors).toHaveLength(5);
            expect(geo.floors).toEqual([...geo.floors].sort((a, b) => a - b));
            expect(geo.plate).toBeGreaterThan(geo.floors[geo.floors.length - 1]);
        });

        test('ladders sit in the gaps between the burger columns', async ({ page }) => {
            const geo = await page.evaluate(() => ({
                ladders: LADDER_COLS.slice(),
                burgers: BURGER_COLS.slice(),
                pieceW: PIECE_COLS,
            }));
            expect(geo.ladders).toHaveLength(5);
            expect(geo.burgers).toHaveLength(4);
            // No burger column overlaps a ladder column.
            for (const b of geo.burgers) {
                for (let i = 0; i < geo.pieceW; i++) {
                    expect(geo.ladders).not.toContain(b + i);
                }
            }
        });

        test('every ladder spans the full height of the tower', async ({ page }) => {
            const ok = await page.evaluate(() =>
                LADDER_COLS.every((c) => ladderTopY(c) === floorY(FLOOR_ROWS[0]) &&
                    ladderBottomY(c) === floorY(FLOOR_ROWS[FLOOR_ROWS.length - 1])));
            expect(ok).toBe(true);
        });

        test('nextFloorRowBelow walks down the tower and ends at the plate', async ({ page }) => {
            const s = await page.evaluate(() => {
                const out = [];
                let r = FLOOR_ROWS[0];
                for (let i = 0; i < 6; i++) { r = nextFloorRowBelow(r); out.push(r); }
                return { chain: out, expected: [...FLOOR_ROWS.slice(1), PLATE_ROW, PLATE_ROW] };
            });
            expect(s.chain).toEqual(s.expected);
        });
    });

    // -----------------------------------------------------------------------
    // Starting a game
    // -----------------------------------------------------------------------
    test.describe('starting', () => {
        test('Space starts the game and hides the overlay', async ({ page }) => {
            await page.keyboard.press('Space');
            expect(await page.evaluate(() => state)).toBe('running');
            await expect(page.locator('#overlay')).not.toHaveClass(/visible/);
        });

        test('the Start button starts the game', async ({ page }) => {
            await page.locator('#btn-start').click();
            expect(await page.evaluate(() => state)).toBe('running');
        });

        test('a fresh game builds four burgers of four pieces each', async ({ page }) => {
            const s = await page.evaluate(() => {
                startGame();
                return {
                    burgers: burgers.length,
                    pieces: pieces.length,
                    stacked: pieces.filter((p) => p.stacked).length,
                    kinds: burgers.map((b) => pieces.filter((p) => p.burger === b.index).length),
                };
            });
            expect(s.burgers).toBe(4);
            expect(s.pieces).toBe(16);
            expect(s.stacked).toBe(0);
            expect(s.kinds).toEqual([4, 4, 4, 4]);
        });

        test('each burger starts with one piece resting on each of the top four floors', async ({ page }) => {
            const rows = await page.evaluate(() => {
                startGame();
                return burgers.map((b) => pieces.filter((p) => p.burger === b.index)
                    .map((p) => p.row).sort((x, y) => x - y));
            });
            const expected = await page.evaluate(() => FLOOR_ROWS.slice(0, 4));
            for (const r of rows) expect(r).toEqual(expected);
        });

        test('the chef starts on the bottom floor with a full pepper shaker', async ({ page }) => {
            const s = await page.evaluate(() => {
                startGame();
                return { y: chef.y, bottom: floorY(FLOOR_ROWS[FLOOR_ROWS.length - 1]), peppers, lives, level, score };
            });
            expect(s.y).toBeCloseTo(s.bottom, 5);
            expect(s.peppers).toBe(5);
            expect(s.lives).toBe(3);
            expect(s.level).toBe(1);
            expect(s.score).toBe(0);
        });

        test('level 1 spawns two enemies', async ({ page }) => {
            const n = await page.evaluate(() => { startGame(); return enemies.length; });
            expect(n).toBe(2);
        });

        test('restarting after game over resets the score', async ({ page }) => {
            const s = await page.evaluate(() => {
                startGame();
                score = 900; lives = 0; state = 'over';
                startGame();
                return { score, lives, state };
            });
            expect(s).toEqual({ score: 0, lives: 3, state: 'running' });
        });
    });

    // -----------------------------------------------------------------------
    // Chef movement
    // -----------------------------------------------------------------------
    test.describe('chef movement', () => {
        test('walking right increases x and keeps the chef on the floor line', async ({ page }) => {
            const before = await page.evaluate(() => { startGame(); enemies.length = 0; return { x: chef.x, y: chef.y }; });
            await page.evaluate(() => setChefDir('right'));
            await advance(page, 0.5);
            const after = await page.evaluate(() => ({ x: chef.x, y: chef.y }));
            expect(after.x).toBeGreaterThan(before.x);
            expect(after.y).toBeCloseTo(before.y, 5);
        });

        test('walking left decreases x', async ({ page }) => {
            const before = await page.evaluate(() => { startGame(); enemies.length = 0; return chef.x; });
            await page.evaluate(() => setChefDir('left'));
            await advance(page, 0.5);
            expect(await page.evaluate(() => chef.x)).toBeLessThan(before);
        });

        test('the chef cannot walk off the left edge', async ({ page }) => {
            await page.evaluate(() => { startGame(); enemies.length = 0; setChefDir('left'); });
            await advance(page, 20);
            const s = await page.evaluate(() => ({ x: chef.x, min: TILE / 2 }));
            expect(s.x).toBeCloseTo(s.min, 3);
        });

        test('the chef cannot walk off the right edge', async ({ page }) => {
            await page.evaluate(() => { startGame(); enemies.length = 0; setChefDir('right'); });
            await advance(page, 20);
            const s = await page.evaluate(() => ({ x: chef.x, max: CANVAS_W - TILE / 2 }));
            expect(s.x).toBeCloseTo(s.max, 3);
        });

        test('the chef climbs up when standing on a ladder column', async ({ page }) => {
            const before = await page.evaluate(() => { startGame(); enemies.length = 0; return chef.y; });
            await page.evaluate(() => setChefDir('up'));
            await advance(page, 1.0);
            expect(await page.evaluate(() => chef.y)).toBeLessThan(before);
        });

        test('the chef cannot climb above the top floor', async ({ page }) => {
            await page.evaluate(() => { startGame(); enemies.length = 0; setChefDir('up'); });
            await advance(page, 30);
            const s = await page.evaluate(() => ({ y: chef.y, top: floorY(FLOOR_ROWS[0]) }));
            expect(s.y).toBeCloseTo(s.top, 3);
        });

        test('the chef cannot climb below the bottom floor', async ({ page }) => {
            await page.evaluate(() => { startGame(); enemies.length = 0; setChefDir('down'); });
            await advance(page, 30);
            const s = await page.evaluate(() => ({ y: chef.y, bottom: floorY(FLOOR_ROWS[FLOOR_ROWS.length - 1]) }));
            expect(s.y).toBeCloseTo(s.bottom, 3);
        });

        test('the chef cannot climb where there is no ladder', async ({ page }) => {
            const s = await page.evaluate(() => {
                startGame(); enemies.length = 0;
                chef.x = ladderX(LADDER_COLS[0]) + TILE * 3; // mid-burger, no ladder
                const y0 = chef.y;
                setChefDir('up');
                for (let i = 0; i < 60; i++) step(1 / 60);
                return { y0, y1: chef.y };
            });
            expect(s.y1).toBeCloseTo(s.y0, 5);
        });

        test('pressing a horizontal key mid-ladder snaps the chef back to a floor', async ({ page }) => {
            const s = await page.evaluate(() => {
                startGame(); enemies.length = 0;
                setChefDir('up');
                for (let i = 0; i < 12; i++) step(1 / 60); // partway up a ladder
                const mid = chef.y;
                setChefDir('right');
                for (let i = 0; i < 12; i++) step(1 / 60);
                return { mid, y: chef.y, floors: FLOOR_ROWS.map((r) => r * TILE) };
            });
            expect(s.floors.some((f) => Math.abs(f - s.y) < 0.001)).toBe(true);
            expect(s.mid).not.toBeCloseTo(s.y, 3);
        });

        test('holding a blocked direction keeps the chef walking until a ladder appears', async ({ page }) => {
            const s = await page.evaluate(() => {
                startGame(); enemies.length = 0;
                chef.x = ladderX(LADDER_COLS[0]);
                chef.y = floorY(FLOOR_ROWS[0]);
                setChefDir('right');
                for (let i = 0; i < 30; i++) step(1 / 60);   // walk clear of the ladder
                const midX = chef.x;
                setChefDir('down');                          // nothing to climb here yet
                for (let i = 0; i < 120; i++) step(1 / 60);
                return { midX, x: chef.x, y: chef.y, ladder: ladderX(LADDER_COLS[1]), top: floorY(FLOOR_ROWS[0]) };
            });
            expect(s.midX).toBeGreaterThan(s.top);           // sanity: it did start walking
            expect(s.x).toBeCloseTo(s.ladder, 3);            // carried on to the next ladder
            expect(s.y).toBeGreaterThan(s.top);              // and then climbed down it
        });

        test('a blocked direction on the bottom girder does not stall the chef', async ({ page }) => {
            const s = await page.evaluate(() => {
                startGame(); enemies.length = 0;
                setChefDir('right');
                for (let i = 0; i < 30; i++) step(1 / 60);
                const x0 = chef.x;
                setChefDir('down');                          // already as low as it gets
                for (let i = 0; i < 30; i++) step(1 / 60);
                return { x0, x1: chef.x, y: chef.y, bottom: floorY(FLOOR_ROWS[FLOOR_ROWS.length - 1]) };
            });
            expect(s.x1).toBeGreaterThan(s.x0);
            expect(s.y).toBeCloseTo(s.bottom, 5);
        });

        test('arrow keys drive the chef', async ({ page }) => {
            await page.evaluate(() => startGame());
            const x0 = await page.evaluate(() => chef.x);
            await page.keyboard.down('ArrowRight');
            expect(await page.evaluate(() => chef.dir)).toBe('right');
            await advance(page, 0.4);
            await page.keyboard.up('ArrowRight');
            expect(await page.evaluate(() => chef.x)).toBeGreaterThan(x0);
            expect(await page.evaluate(() => chef.dir)).toBe(null);
        });

        test('the chef remembers which way it is facing', async ({ page }) => {
            const f = await page.evaluate(() => {
                startGame(); enemies.length = 0;
                setChefDir('left');
                step(1 / 60);
                const left = chef.facing;
                setChefDir(null);
                return { left, kept: chef.facing };
            });
            expect(f.left).toBe('left');
            expect(f.kept).toBe('left');
        });
    });

    // -----------------------------------------------------------------------
    // Walking ingredients down
    // -----------------------------------------------------------------------
    test.describe('stepping on ingredients', () => {
        test('walking over one tile of a piece presses only that segment', async ({ page }) => {
            const segs = await page.evaluate(() => {
                startGame(); enemies.length = 0;
                const p = pieces.find((q) => q.burger === 0 && q.row === FLOOR_ROWS[0]);
                chef.y = floorY(p.row);
                chef.x = (p.col + 0.5) * TILE;
                step(1 / 60);
                return p.segs.slice();
            });
            expect(segs).toEqual([true, false, false, false]);
        });

        test('pressing every segment drops the piece', async ({ page }) => {
            const s = await page.evaluate(() => {
                startGame(); enemies.length = 0;
                const p = pieces.find((q) => q.burger === 0 && q.row === FLOOR_ROWS[0]);
                chef.y = floorY(p.row);
                chef.x = (p.col + 0.5) * TILE;
                setChefDir('right');
                for (let i = 0; i < 600 && !p.falling; i++) step(1 / 60);
                return { falling: p.falling, segs: p.segs.slice(), score };
            });
            expect(s.falling).toBe(true);
            expect(s.score).toBeGreaterThan(0);
        });

        test('a piece already falling cannot be pressed again', async ({ page }) => {
            const s = await page.evaluate(() => {
                startGame(); enemies.length = 0;
                const p = pieces.find((q) => q.burger === 0 && q.row === FLOOR_ROWS[0]);
                dropPiece(p);
                const first = score;
                const again = dropPiece(p);
                return { again, first, now: score };
            });
            expect(s.again).toBe(false);
            expect(s.now).toBe(s.first);
        });

        test('the chef only presses pieces on its own floor', async ({ page }) => {
            const pressed = await page.evaluate(() => {
                startGame(); enemies.length = 0;
                const p = pieces.find((q) => q.burger === 0 && q.row === FLOOR_ROWS[1]);
                chef.y = floorY(FLOOR_ROWS[0]); // one floor above the piece
                chef.x = (p.col + 0.5) * TILE;
                step(1 / 60);
                return p.segs.some(Boolean);
            });
            expect(pressed).toBe(false);
        });
    });

    // -----------------------------------------------------------------------
    // Falling and stacking
    // -----------------------------------------------------------------------
    test.describe('falling ingredients', () => {
        test('a dropped piece falls to the next floor down', async ({ page }) => {
            const s = await page.evaluate(() => {
                startGame(); enemies.length = 0;
                // Clear burger 0 so nothing chains.
                pieces = pieces.filter((p) => p.burger !== 0 || p.row === FLOOR_ROWS[0]);
                const p = pieces.find((q) => q.burger === 0);
                dropPiece(p);
                for (let i = 0; i < 600 && p.falling; i++) step(1 / 60);
                return { row: p.row, expected: FLOOR_ROWS[1], falling: p.falling, y: p.y };
            });
            expect(s.falling).toBe(false);
            expect(s.row).toBe(s.expected);
        });

        test('landing on a resting piece pushes it down as well', async ({ page }) => {
            const s = await page.evaluate(() => {
                startGame(); enemies.length = 0;
                const top = pieces.find((q) => q.burger === 0 && q.row === FLOOR_ROWS[0]);
                const next = pieces.find((q) => q.burger === 0 && q.row === FLOOR_ROWS[1]);
                dropPiece(top);
                for (let i = 0; i < 60; i++) step(1 / 60);
                return { chained: next.falling || next.row !== FLOOR_ROWS[1] };
            });
            expect(s.chained).toBe(true);
        });

        test('a cascade settles the whole burger on the lowest girder', async ({ page }) => {
            const s = await page.evaluate(() => {
                startGame(); enemies.length = 0;
                const top = pieces.find((q) => q.burger === 0 && q.row === FLOOR_ROWS[0]);
                dropPiece(top);
                for (let i = 0; i < 1200; i++) step(1 / 60);
                const mine = pieces.filter((q) => q.burger === 0);
                return {
                    rows: mine.map((q) => q.row),
                    bottom: FLOOR_ROWS[FLOOR_ROWS.length - 1],
                    falling: mine.filter((q) => q.falling).length,
                    stacked: mine.filter((q) => q.stacked).length,
                };
            });
            expect(s.falling).toBe(0);
            expect(s.stacked).toBe(0);           // not on the plate yet
            expect(s.rows).toEqual([s.bottom, s.bottom, s.bottom, s.bottom]);
        });

        test('the settled stack keeps its original top-to-bottom order', async ({ page }) => {
            const ys = await page.evaluate(() => {
                startGame(); enemies.length = 0;
                const top = pieces.find((q) => q.burger === 0 && q.row === FLOOR_ROWS[0]);
                dropPiece(top);
                for (let i = 0; i < 1200; i++) step(1 / 60);
                return pieces.filter((q) => q.burger === 0)
                    .sort((a, b) => a.order - b.order).map((q) => q.y);
            });
            // order 0 is the top bun, so its y must stay the smallest.
            for (let i = 1; i < ys.length; i++) expect(ys[i]).toBeGreaterThan(ys[i - 1]);
        });

        test('pushing the settled stack buries the burger on its plate', async ({ page }) => {
            const s = await page.evaluate(() => {
                startGame(); enemies.length = 0;
                buryBurger(0);
                const mine = pieces.filter((q) => q.burger === 0);
                return {
                    stacked: mine.filter((q) => q.stacked).length,
                    total: mine.length,
                    stack: burgers[0].stack.length,
                    ys: burgers[0].stack.map((q) => q.y),
                    plate: PLATE_ROW * TILE,
                };
            });
            expect(s.stacked).toBe(s.total);
            expect(s.stack).toBe(s.total);
            // Landing order piles upward from the plate, and nothing sinks past it.
            for (let i = 1; i < s.ys.length; i++) expect(s.ys[i]).toBeLessThan(s.ys[i - 1]);
            for (const y of s.ys) expect(y).toBeLessThanOrEqual(s.plate + 0.001);
        });

        test('dropping every burger clears the level', async ({ page }) => {
            const s = await page.evaluate(() => {
                startGame(); enemies.length = 0;
                for (const b of burgers) buryBurger(b.index);
                return { state, remaining: piecesRemaining(), score };
            });
            expect(s.remaining).toBe(0);
            expect(s.state).toBe('levelclear');
            expect(s.score).toBeGreaterThan(16 * 50);
        });

        test('after the level-clear pause the next level is built', async ({ page }) => {
            const s = await page.evaluate(() => {
                startGame(); enemies.length = 0;
                for (const b of burgers) buryBurger(b.index);
                for (let i = 0; i < 60 * 4; i++) step(1 / 60);
                return { level, state, remaining: piecesRemaining(), peppers };
            });
            expect(s.level).toBe(2);
            expect(s.state).toBe('running');
            expect(s.remaining).toBe(16);
            expect(s.peppers).toBe(5);
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
                const x0 = e.x, y0 = e.y;
                for (let i = 0; i < 120; i++) step(1 / 60);
                return Math.abs(e.x - x0) + Math.abs(e.y - y0);
            });
            expect(moved).toBeGreaterThan(1);
        });

        test('enemies stay on the walkable rails', async ({ page }) => {
            const offRail = await page.evaluate(() => {
                startGame();
                let bad = 0;
                for (let i = 0; i < 900; i++) {
                    step(1 / 60);
                    for (const e of enemies) {
                        if (e.dead || e.riding) continue;
                        const onFloor = FLOOR_ROWS.some((r) => Math.abs(e.y - r * TILE) < 0.01);
                        const onLadder = LADDER_COLS.some((c) => Math.abs(e.x - ladderX(c)) < 0.01);
                        if (!onFloor && !onLadder) bad++;
                    }
                }
                return bad;
            });
            expect(offRail).toBe(0);
        });

        test('touching an enemy costs a life', async ({ page }) => {
            const s = await page.evaluate(() => {
                startGame();
                const e = enemies[0];
                e.x = chef.x; e.y = chef.y; e.stun = 0;
                step(1 / 60);
                return { lives, state };
            });
            expect(s.lives).toBe(2);
            expect(s.state).toBe('dying');
        });

        test('losing the last life ends the game', async ({ page }) => {
            const s = await page.evaluate(() => {
                startGame();
                lives = 1;
                const e = enemies[0];
                e.x = chef.x; e.y = chef.y; e.stun = 0;
                step(1 / 60);
                return { lives, state };
            });
            expect(s.lives).toBe(0);
            expect(s.state).toBe('over');
        });

        test('after dying the chef and enemies return to their spawn points', async ({ page }) => {
            const s = await page.evaluate(() => {
                startGame();
                const home = { x: chef.x, y: chef.y };
                const e = enemies[0];
                e.x = chef.x; e.y = chef.y; e.stun = 0;
                step(1 / 60);
                for (let i = 0; i < 60 * 4; i++) step(1 / 60);
                return { home, x: chef.x, y: chef.y, state };
            });
            expect(s.state).toBe('running');
            expect(s.x).toBeCloseTo(s.home.x, 3);
            expect(s.y).toBeCloseTo(s.home.y, 3);
        });

        test('a stunned enemy is harmless', async ({ page }) => {
            const s = await page.evaluate(() => {
                startGame();
                const e = enemies[0];
                e.x = chef.x; e.y = chef.y; e.stun = 3;
                step(1 / 60);
                return { lives, state };
            });
            expect(s.lives).toBe(3);
            expect(s.state).toBe('running');
        });

        test('an enemy standing on a dropping piece rides it down and is squashed', async ({ page }) => {
            const s = await page.evaluate(() => {
                startGame();
                const p = pieces.find((q) => q.burger === 0 && q.row === FLOOR_ROWS[0]);
                const e = enemies[0];
                enemies.length = 1;              // keep only the rider
                e.stun = 0; e.dead = false;
                e.x = (p.col + 2) * TILE;
                e.y = floorY(p.row);
                dropPiece(p);
                const riding = e.riding === p;
                const startY = e.y;
                for (let i = 0; i < 900 && !e.dead; i++) step(1 / 60);
                return { riding, dead: e.dead, score, rode: e.y - startY };
            });
            expect(s.riding).toBe(true);
            expect(s.dead).toBe(true);
            expect(s.rode).toBeGreaterThan(0);   // it was carried downwards
            expect(s.score).toBeGreaterThan(200);
        });

        test('a squashed enemy comes back after a delay', async ({ page }) => {
            const s = await page.evaluate(() => {
                startGame();
                const e = enemies[0];
                killEnemy(e);
                const wasDead = e.dead;
                for (let i = 0; i < 60 * 12; i++) step(1 / 60);
                return { wasDead, dead: e.dead };
            });
            expect(s.wasDead).toBe(true);
            expect(s.dead).toBe(false);
        });

        test('later levels send more enemies', async ({ page }) => {
            const counts = await page.evaluate(() => {
                startGame();
                const out = [enemies.length];
                for (let l = 0; l < 3; l++) { nextLevel(); out.push(enemies.length); }
                return out;
            });
            expect(counts[1]).toBeGreaterThan(counts[0]);
            expect(counts[counts.length - 1]).toBeGreaterThanOrEqual(counts[1]);
        });
    });

    // -----------------------------------------------------------------------
    // Pepper
    // -----------------------------------------------------------------------
    test.describe('pepper', () => {
        test('spraying pepper uses one shake and updates the hud', async ({ page }) => {
            await page.evaluate(() => startGame());
            expect(await page.evaluate(() => sprayPepper())).toBe(true);
            expect(await page.evaluate(() => peppers)).toBe(4);
            await expect(page.locator('#peppers')).toHaveText('4');
        });

        test('pepper stuns an enemy standing in front of the chef', async ({ page }) => {
            const s = await page.evaluate(() => {
                startGame();
                const e = enemies[0];
                e.dead = false; e.stun = 0;
                setChefDir('right');
                step(1 / 60);
                e.x = chef.x + TILE;
                e.y = chef.y;
                sprayPepper();
                return e.stun;
            });
            expect(s).toBeGreaterThan(0);
        });

        test('pepper does not reach enemies behind the chef', async ({ page }) => {
            const s = await page.evaluate(() => {
                startGame();
                const e = enemies[0];
                e.dead = false; e.stun = 0;
                setChefDir('right');
                step(1 / 60);
                e.x = chef.x - TILE * 3;
                e.y = chef.y;
                sprayPepper();
                return e.stun;
            });
            expect(s).toBe(0);
        });

        test('a stun wears off', async ({ page }) => {
            const s = await page.evaluate(() => {
                startGame();
                const e = enemies[0];
                e.stun = 0.5;
                for (let i = 0; i < 60 * 2; i++) step(1 / 60);
                return e.stun;
            });
            expect(s).toBeLessThanOrEqual(0);
        });

        test('an empty shaker cannot spray', async ({ page }) => {
            const s = await page.evaluate(() => {
                startGame();
                peppers = 0;
                return { sprayed: sprayPepper(), peppers };
            });
            expect(s.sprayed).toBe(false);
            expect(s.peppers).toBe(0);
        });

        test('the Space key sprays pepper while running', async ({ page }) => {
            await page.evaluate(() => startGame());
            await page.keyboard.press('Space');
            expect(await page.evaluate(() => peppers)).toBe(4);
        });
    });

    // -----------------------------------------------------------------------
    // Scoring, pausing and game over
    // -----------------------------------------------------------------------
    test.describe('scoring and flow', () => {
        test('dropping a piece scores points and updates the hud', async ({ page }) => {
            const s = await page.evaluate(() => {
                startGame();
                dropPiece(pieces[0]);
                return score;
            });
            expect(s).toBe(await page.evaluate(() => PIECE_POINTS));
            await expect(page.locator('#score')).toHaveText(String(s));
        });

        test('P pauses and resumes', async ({ page }) => {
            await page.evaluate(() => startGame());
            await page.keyboard.press('p');
            expect(await page.evaluate(() => state)).toBe('paused');
            await expect(page.locator('#overlay')).toHaveClass(/visible/);
            await page.keyboard.press('p');
            expect(await page.evaluate(() => state)).toBe('running');
        });

        test('nothing moves while paused', async ({ page }) => {
            const s = await page.evaluate(() => {
                startGame();
                setChefDir('right');
                togglePause();
                const x0 = chef.x;
                for (let i = 0; i < 60; i++) step(1 / 60);
                return { x0, x1: chef.x };
            });
            expect(s.x1).toBeCloseTo(s.x0, 5);
        });

        test('game over shows the overlay and records the best score', async ({ page }) => {
            await page.evaluate(() => {
                startGame();
                score = 3210;
                lives = 1;
                const e = enemies[0];
                e.x = chef.x; e.y = chef.y; e.stun = 0;
                step(1 / 60);
            });
            await expect(page.locator('#overlay')).toHaveClass(/visible/);
            await expect(page.locator('#overlay-title')).toContainText(/game over/i);
            await expect(page.locator('#best')).toHaveText('3210');
            expect(await page.evaluate(() => localStorage.getItem('burgertime-best'))).toBe('3210');
        });

        test('the best score survives a reload', async ({ page }) => {
            await page.evaluate(() => {
                startGame();
                score = 777; lives = 1;
                const e = enemies[0];
                e.x = chef.x; e.y = chef.y; e.stun = 0;
                step(1 / 60);
            });
            await page.reload();
            await expect(page.locator('#best')).toHaveText('777');
        });

        test('the hud tracks lives and level', async ({ page }) => {
            await page.evaluate(() => { startGame(); nextLevel(); });
            await expect(page.locator('#level')).toHaveText('2');
            await expect(page.locator('#lives')).toHaveText('3');
        });

        test('the on-screen help lists the controls', async ({ page }) => {
            await expect(page.locator('.help')).toContainText(/pepper/i);
            await expect(page.locator('.help')).toContainText(/pause/i);
        });
    });

    // -----------------------------------------------------------------------
    // Rendering smoke test
    // -----------------------------------------------------------------------
    test.describe('rendering', () => {
        test('the canvas is painted after a frame', async ({ page }) => {
            const painted = await page.evaluate(() => {
                startGame();
                draw();
                const data = ctx.getImageData(0, 0, CANVAS_W, CANVAS_H).data;
                let nonBlank = 0;
                for (let i = 0; i < data.length; i += 4) {
                    if (data[i] !== data[0] || data[i + 1] !== data[1] || data[i + 2] !== data[2]) nonBlank++;
                }
                return nonBlank;
            });
            expect(painted).toBeGreaterThan(1000);
        });

        test('no console errors during a burst of play', async ({ page }) => {
            const errors = [];
            page.on('pageerror', (e) => errors.push(String(e)));
            await page.evaluate(() => {
                startGame();
                setChefDir('right');
                for (let i = 0; i < 600; i++) { step(1 / 60); draw(); }
            });
            expect(errors).toEqual([]);
        });
    });
});
