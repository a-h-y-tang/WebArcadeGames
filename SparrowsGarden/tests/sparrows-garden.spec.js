const { test, expect } = require('@playwright/test');
const path = require('path');
const { pathToFileURL } = require('url');

const GAME_URL = pathToFileURL(path.resolve(__dirname, '../index.html')).href;

// Every test that touches the simulation calls startGame() then stopLoop(), so
// requestAnimationFrame never races the hand-stepped clock.
test.describe("Sparrow's Garden", () => {
    test.beforeEach(async ({ page }) => {
        await page.addInitScript(() => {
            try { localStorage.removeItem('sparrows-garden-best'); } catch (e) {}
        });
        await page.goto(GAME_URL);
    });

    // -----------------------------------------------------------------------
    // Initial state
    // -----------------------------------------------------------------------
    test.describe('initial state', () => {
        test("page title is Sparrow's Garden", async ({ page }) => {
            await expect(page).toHaveTitle("Sparrow's Garden");
        });

        test('canvas has the documented dimensions', async ({ page }) => {
            const canvas = page.locator('#canvas');
            await expect(canvas).toHaveAttribute('width', '456');
            await expect(canvas).toHaveAttribute('height', '504');
        });

        test('the garden is 21 rows by 19 columns', async ({ page }) => {
            expect(await page.evaluate(() => ({ rows: grid.length, cols: grid[0].length })))
                .toEqual({ rows: 21, cols: 19 });
        });

        test('state is idle and the overlay is showing', async ({ page }) => {
            expect(await page.evaluate(() => state)).toBe('idle');
            await expect(page.locator('#overlay')).toHaveClass(/visible/);
        });

        test('score, lives, level and best start at 0 / 3 / 1 / 0', async ({ page }) => {
            await expect(page.locator('#score')).toHaveText('0');
            await expect(page.locator('#lives')).toHaveText('3');
            await expect(page.locator('#level')).toHaveText('1');
            await expect(page.locator('#best')).toHaveText('0');
        });

        test('a fresh garden holds 200 seeds and 4 sunflowers', async ({ page }) => {
            const counts = await page.evaluate(() => {
                const flat = grid.flat();
                return {
                    seeds: flat.filter(v => v === SEED).length,
                    sunflowers: flat.filter(v => v === SUNFLOWER).length,
                    left: seedsLeft,
                };
            });
            expect(counts).toEqual({ seeds: 200, sunflowers: 4, left: 204 });
        });

        test('the HUD shows how much is left to peck', async ({ page }) => {
            await expect(page.locator('#seeds')).toHaveText('204');
        });

        test('the garden walls enclose the maze', async ({ page }) => {
            const leaks = await page.evaluate(() => {
                const bad = [];
                for (let c = 0; c < grid[0].length; c++) {
                    if (grid[0][c] !== WALL) bad.push(['top', c]);
                    if (grid[grid.length - 1][c] !== WALL) bad.push(['bottom', c]);
                }
                for (let r = 0; r < grid.length; r++) {
                    if (grid[r][0] !== WALL) bad.push(['left', r]);
                    if (grid[r][grid[0].length - 1] !== WALL) bad.push(['right', r]);
                }
                return bad;
            });
            expect(leaks).toEqual([]);
        });

        test('the garden is left-right symmetric', async ({ page }) => {
            const asym = await page.evaluate(() => {
                const bad = [];
                for (let r = 0; r < grid.length; r++) {
                    for (let c = 0; c < grid[0].length; c++) {
                        const a = grid[r][c] === WALL;
                        const b = grid[r][grid[0].length - 1 - c] === WALL;
                        if (a !== b) bad.push([r, c]);
                    }
                }
                return bad;
            });
            expect(asym).toEqual([]);
        });

        test('every open cell can be reached from the sparrow start', async ({ page }) => {
            const res = await page.evaluate(() => {
                const R = grid.length, C = grid[0].length;
                let open = 0;
                for (let r = 0; r < R; r++) for (let c = 0; c < C; c++) if (grid[r][c] !== WALL) open++;
                const seen = new Set([playerStart.r + ',' + playerStart.c]);
                const queue = [[playerStart.r, playerStart.c]];
                while (queue.length) {
                    const [r, c] = queue.shift();
                    for (const [dr, dc] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
                        const nr = r + dr, nc = c + dc;
                        if (!openAt(nr, nc)) continue;
                        const key = nr + ',' + nc;
                        if (!seen.has(key)) { seen.add(key); queue.push([nr, nc]); }
                    }
                }
                return { open, reachable: seen.size };
            });
            expect(res.reachable).toBe(res.open);
        });

        test('the garden has no dead ends', async ({ page }) => {
            const stubs = await page.evaluate(() => {
                const bad = [];
                for (let r = 0; r < grid.length; r++) {
                    for (let c = 0; c < grid[0].length; c++) {
                        if (!openAt(r, c)) continue;
                        let exits = 0;
                        for (const [dr, dc] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
                            if (openAt(r + dr, c + dc)) exits++;
                        }
                        if (exits < 2) bad.push([r, c]);
                    }
                }
                return bad;
            });
            expect(stubs).toEqual([]);
        });

        test('four cats wait in the shed, each with its own corner', async ({ page }) => {
            const res = await page.evaluate(() => ({
                count: cats.length,
                names: cats.map(k => k.name),
                starts: cats.map(k => [k.start.r, k.start.c]),
                onPath: cats.every(k => openAt(k.start.r, k.start.c)),
                corners: cats.map(k => [k.corner.r, k.corner.c]),
            }));
            expect(res.count).toBe(4);
            expect(res.names).toEqual(['Tabby', 'Ginger', 'Smoke', 'Snowy']);
            expect(res.onPath).toBe(true);
            expect(new Set(res.corners.map(String)).size).toBe(4);
        });

        test('the start, the shed and the berry spot carry no seed', async ({ page }) => {
            const res = await page.evaluate(() => ({
                path: PATH,
                start: grid[playerStart.r][playerStart.c],
                shed: cats.map(k => grid[k.start.r][k.start.c]),
                berrySpot: grid[BERRY_CELL.r][BERRY_CELL.c],
            }));
            expect(res.start).toBe(res.path);
            expect(res.shed).toEqual([res.path, res.path, res.path, res.path]);
            expect(res.berrySpot).toBe(res.path);
        });
    });

    // -----------------------------------------------------------------------
    // Starting and pausing
    // -----------------------------------------------------------------------
    test.describe('starting', () => {
        test('the Start button begins play with the sparrow at its start cell', async ({ page }) => {
            await page.locator('#btn-start').click();
            const res = await page.evaluate(() => ({
                state, r: player.r, c: player.c, sr: playerStart.r, sc: playerStart.c,
            }));
            expect(res.state).toBe('playing');
            expect([res.r, res.c]).toEqual([res.sr, res.sc]);
            await expect(page.locator('#overlay')).not.toHaveClass(/visible/);
        });

        test('an arrow key starts play and steers the sparrow', async ({ page }) => {
            await page.keyboard.press('ArrowLeft');
            const res = await page.evaluate(() => ({ state, want: player.want }));
            expect(res.state).toBe('playing');
            expect(res.want).toEqual({ dr: 0, dc: -1 });
        });

        test('P pauses and resumes', async ({ page }) => {
            await page.locator('#btn-start').click();
            await page.keyboard.press('p');
            expect(await page.evaluate(() => state)).toBe('paused');
            await page.keyboard.press('p');
            expect(await page.evaluate(() => state)).toBe('playing');
        });

        test('the overlay button carries on from a pause instead of restarting', async ({ page }) => {
            await page.locator('#btn-start').click();
            await page.evaluate(() => { score = 70; togglePause(); });
            await expect(page.locator('#btn-start')).toHaveText('Resume');
            await page.locator('#btn-start').click();
            expect(await page.evaluate(() => ({ state, score }))).toEqual({ state: 'playing', score: 70 });
            await expect(page.locator('#btn-start')).toHaveText('Start Game');
        });

        test('a paused game does not move', async ({ page }) => {
            const res = await page.evaluate(() => {
                startGame(); stopLoop();
                player.want = { dr: 0, dc: -1 };
                state = 'paused';
                tick(1000);
                return { r: player.r, c: player.c, sc: playerStart.c };
            });
            expect(res.c).toBe(res.sc);
        });
    });

    // -----------------------------------------------------------------------
    // Movement
    // -----------------------------------------------------------------------
    test.describe('movement', () => {
        test('the sparrow hops one cell per cell-time in the chosen direction', async ({ page }) => {
            const res = await page.evaluate(() => {
                startGame(); stopLoop();
                cats = [];
                player.want = { dr: 0, dc: -1 };
                tick(1000 / PLAYER_SPEED);   // exactly one cell
                return { r: player.r, c: player.c, prog: player.prog };
            });
            expect(res.r).toBe(19);
            expect(res.c).toBe(8);
            expect(res.prog).toBeCloseTo(0, 5);
        });

        test('part of a cell-time leaves the sparrow between cells', async ({ page }) => {
            const res = await page.evaluate(() => {
                startGame(); stopLoop();
                cats = [];
                player.want = { dr: 0, dc: -1 };
                tick(1000 / PLAYER_SPEED / 2);
                return { c: player.c, prog: player.prog };
            });
            expect(res.c).toBe(9);
            expect(res.prog).toBeCloseTo(0.5, 2);
        });

        test('a swipe steers the sparrow', async ({ page }) => {
            const res = await page.evaluate(() => {
                startGame(); stopLoop();
                const took = swipe(-40, 3);
                const left = { ...player.want };
                swipe(2, -40);
                return { took, left, up: player.want };
            });
            expect(res.took).toBe(true);
            expect(res.left).toEqual({ dr: 0, dc: -1 });
            expect(res.up).toEqual({ dr: -1, dc: 0 });
        });

        test('a tap is not a swipe', async ({ page }) => {
            const res = await page.evaluate(() => {
                startGame(); stopLoop();
                player.want = { dr: 0, dc: 1 };
                const took = swipe(3, -2);
                return { took, want: player.want };
            });
            expect(res.took).toBe(false);
            expect(res.want).toEqual({ dr: 0, dc: 1 });
        });

        test('a swipe on the idle screen starts the game', async ({ page }) => {
            const res = await page.evaluate(() => {
                swipe(0, 40);
                stopLoop();
                return { state, want: player.want };
            });
            expect(res.state).toBe('playing');
            expect(res.want).toEqual({ dr: 1, dc: 0 });
        });

        test('the sparrow cannot hop into a hedge', async ({ page }) => {
            const res = await page.evaluate(() => {
                startGame(); stopLoop();
                cats = [];
                player.want = { dr: 1, dc: 0 };   // straight down into the wall
                tick(1000);
                return { r: player.r, c: player.c, dir: player.dir };
            });
            expect([res.r, res.c]).toEqual([19, 9]);
            expect(res.dir).toBeNull();
        });

        test('a queued turn is taken at the first corner that allows it', async ({ page }) => {
            const res = await page.evaluate(() => {
                startGame(); stopLoop();
                cats = [];
                player.r = 19; player.c = 9;
                player.want = { dr: 0, dc: -1 };
                tick(4 * 1000 / PLAYER_SPEED);        // hop to column 5
                const atTurn = { r: player.r, c: player.c };
                player.want = { dr: -1, dc: 0 };      // up is only open at column 5
                tick(1000 / PLAYER_SPEED);
                return { atTurn, r: player.r, c: player.c };
            });
            expect(res.atTurn).toEqual({ r: 19, c: 5 });
            expect([res.r, res.c]).toEqual([18, 5]);
        });

        test('the sparrow keeps going when the queued turn is blocked', async ({ page }) => {
            const res = await page.evaluate(() => {
                startGame(); stopLoop();
                cats = [];
                player.want = { dr: 0, dc: -1 };
                tick(1000 / PLAYER_SPEED);            // at 19,8
                player.want = { dr: -1, dc: 0 };      // up is a hedge there
                tick(1000 / PLAYER_SPEED);
                return { r: player.r, c: player.c };
            });
            expect([res.r, res.c]).toEqual([19, 7]);
        });
    });

    // -----------------------------------------------------------------------
    // Seeds, sunflowers, berry
    // -----------------------------------------------------------------------
    test.describe('pecking', () => {
        test('a seed scores 10, is removed, and lowers the count', async ({ page }) => {
            const res = await page.evaluate(() => {
                startGame(); stopLoop();
                cats = [];
                const before = seedsLeft;
                player.want = { dr: 0, dc: -1 };
                tick(1000 / PLAYER_SPEED);
                return { score, before, after: seedsLeft, cell: grid[19][8] };
            });
            expect(res.score).toBe(10);
            expect(res.after).toBe(res.before - 1);
            expect(res.cell).toBe(1); // PATH
        });

        test('an empty cell scores nothing the second time over it', async ({ page }) => {
            const res = await page.evaluate(() => {
                startGame(); stopLoop();
                cats = [];
                player.want = { dr: 0, dc: -1 };
                tick(1000 / PLAYER_SPEED);
                const once = score;
                player.want = { dr: 0, dc: 1 };
                tick(1000 / PLAYER_SPEED);   // hop back onto the empty cell
                return { once, twice: score, r: player.r, c: player.c };
            });
            expect([res.r, res.c]).toEqual([19, 9]);
            expect(res.twice).toBe(res.once);
        });

        test('the HUD follows the score and the seeds left', async ({ page }) => {
            await page.evaluate(() => {
                startGame(); stopLoop();
                cats = [];
                player.want = { dr: 0, dc: -1 };
                tick(2 * 1000 / PLAYER_SPEED);
            });
            await expect(page.locator('#score')).toHaveText('20');
            await expect(page.locator('#seeds')).toHaveText('202');
        });

        test('a sunflower scores 50 and turns every prowling cat shy', async ({ page }) => {
            const res = await page.evaluate(() => {
                startGame(); stopLoop();
                player.r = 3; player.c = 2;      // beside the top-left sunflower
                player.prog = 0; player.dir = null;
                player.want = { dr: 0, dc: -1 };
                tick(1000 / PLAYER_SPEED);
                return {
                    score, cell: grid[3][1],
                    modes: cats.map(k => k.mode),
                    timer: sunflowerTimer,
                };
            });
            expect(res.score).toBe(50);
            expect(res.cell).toBe(1); // PATH
            expect(res.modes).toEqual(['shy', 'shy', 'shy', 'shy']);
            expect(res.timer).toBeGreaterThan(0);
        });

        test('shyness wears off and the cats prowl again', async ({ page }) => {
            const res = await page.evaluate(() => {
                startGame(); stopLoop();
                makeCatsShy();
                const during = cats.map(k => k.mode);
                tick(SUNFLOWER_MS + 50);
                return { during, after: cats.map(k => k.mode), timer: sunflowerTimer };
            });
            expect(res.during).toEqual(['shy', 'shy', 'shy', 'shy']);
            expect(res.after.some(m => m === 'shy')).toBe(false);
            expect(res.timer).toBe(0);
        });

        test('a berry appears once 60 seeds have gone and is worth 100', async ({ page }) => {
            const res = await page.evaluate(() => {
                startGame(); stopLoop();
                cats = [];
                seedsEaten = 59;
                player.want = { dr: 0, dc: -1 };
                tick(1000 / PLAYER_SPEED);          // the 60th seed
                const appeared = berry && { r: berry.r, c: berry.c };
                const before = score;
                player.r = berry.r; player.c = berry.c; player.prog = 0;
                player.dir = null; player.want = { dr: 0, dc: 0 };
                collectAt(berry.r, berry.c);
                return { appeared, gained: score - before, gone: berry };
            });
            expect(res.appeared).toEqual({ r: 11, c: 9 });
            expect(res.gained).toBe(100);
            expect(res.gone).toBeNull();
        });

        test('an uneaten berry disappears when its time runs out', async ({ page }) => {
            const res = await page.evaluate(() => {
                startGame(); stopLoop();
                cats = [];
                spawnBerry();
                const there = !!berry;
                tick(BERRY_MS + 50);
                return { there, after: berry };
            });
            expect(res.there).toBe(true);
            expect(res.after).toBeNull();
        });
    });

    // -----------------------------------------------------------------------
    // Cat behaviour
    // -----------------------------------------------------------------------
    test.describe('the cats', () => {
        test('a prowling cat steps towards the sparrow', async ({ page }) => {
            const res = await page.evaluate(() => {
                startGame(); stopLoop();
                const cat = cats[0];
                cat.r = 9; cat.c = 6; cat.prog = 0; cat.dir = null; cat.mode = 'chase';
                player.r = 19; player.c = 9; player.prog = 0;   // far below
                const dir = chooseCatDir(cat);
                return dir;
            });
            expect(res).toEqual({ dr: 1, dc: 0 });   // down, towards the sparrow
        });

        test('a shy cat runs away from the sparrow', async ({ page }) => {
            const res = await page.evaluate(() => {
                startGame(); stopLoop();
                const cat = cats[0];
                cat.r = 9; cat.c = 6; cat.prog = 0; cat.dir = null; cat.mode = 'shy';
                player.r = 19; player.c = 9; player.prog = 0;
                return chooseCatDir(cat);
            });
            expect(res).toEqual({ dr: -1, dc: 0 });  // up, away from the sparrow
        });

        test('a cat never reverses while it has another way to go', async ({ page }) => {
            const res = await page.evaluate(() => {
                startGame(); stopLoop();
                const cat = cats[0];
                cat.r = 9; cat.c = 6; cat.prog = 0; cat.mode = 'chase';
                cat.dir = { dr: 1, dc: 0 };           // arrived heading down
                player.r = 3; player.c = 9;           // target is now above it
                const dir = chooseCatDir(cat);
                return dir;
            });
            expect(res).not.toEqual({ dr: -1, dc: 0 });
        });

        test('a scattering cat heads for its own corner', async ({ page }) => {
            const res = await page.evaluate(() => {
                startGame(); stopLoop();
                return cats.map(k => {
                    k.mode = 'scatter';
                    const t = catTarget(k);
                    return [t.r === k.corner.r, t.c === k.corner.c];
                });
            });
            expect(res).toEqual([[true, true], [true, true], [true, true], [true, true]]);
        });

        test('the cats scatter first and then settle into the chase', async ({ page }) => {
            const res = await page.evaluate(() => {
                startGame(); stopLoop();
                cats.forEach(k => { k.r = 9; k.c = 6; });
                const first = cats.map(k => k.mode);
                tick(SCATTER_MS + 100);
                return { first, later: cats.map(k => k.mode) };
            });
            expect(res.first).toEqual(['scatter', 'scatter', 'scatter', 'scatter']);
            expect(res.later.every(m => m === 'chase')).toBe(true);
        });

        test("Snowy only chases inside eight cells", async ({ page }) => {
            const res = await page.evaluate(() => {
                startGame(); stopLoop();
                const snowy = cats.find(k => k.name === 'Snowy');
                snowy.mode = 'chase';
                snowy.r = 9; snowy.c = 6;
                player.r = 19; player.c = 9;          // far away
                const far = catTarget(snowy);
                player.r = 11; player.c = 7;          // close
                const near = catTarget(snowy);
                return {
                    far: [far.r, far.c], corner: [snowy.corner.r, snowy.corner.c],
                    near: [near.r, near.c],
                };
            });
            expect(res.far).toEqual(res.corner);
            expect(res.near).toEqual([11, 7]);
        });

        test('Ginger aims four cells ahead of the sparrow', async ({ page }) => {
            const res = await page.evaluate(() => {
                startGame(); stopLoop();
                const ginger = cats.find(k => k.name === 'Ginger');
                ginger.mode = 'chase';
                player.r = 9; player.c = 9; player.dir = { dr: 0, dc: -1 };
                const t = catTarget(ginger);
                return [t.r, t.c];
            });
            expect(res).toEqual([9, 5]);
        });
    });

    // -----------------------------------------------------------------------
    // Catching and shooing
    // -----------------------------------------------------------------------
    test.describe('catching and shooing', () => {
        test('a prowling cat that reaches the sparrow costs a life', async ({ page }) => {
            const res = await page.evaluate(() => {
                startGame(); stopLoop();
                const cat = cats[0];
                cat.mode = 'chase';
                cat.r = player.r; cat.c = player.c; cat.prog = 0;
                checkCats();
                return { lives, state, r: player.r, c: player.c, sr: playerStart.r, sc: playerStart.c };
            });
            expect(res.lives).toBe(2);
            expect(res.state).toBe('playing');
            expect([res.r, res.c]).toEqual([res.sr, res.sc]);
        });

        test('the cats are sent back to the shed after a catch', async ({ page }) => {
            const res = await page.evaluate(() => {
                startGame(); stopLoop();
                cats.forEach(k => { k.r = 11; k.c = 9; k.mode = 'chase'; });
                cats[0].r = player.r; cats[0].c = player.c;
                checkCats();
                return cats.map(k => [k.r === k.start.r, k.c === k.start.c]);
            });
            expect(res).toEqual([[true, true], [true, true], [true, true], [true, true]]);
        });

        test('losing the last life ends the game and records the best', async ({ page }) => {
            const res = await page.evaluate(() => {
                startGame(); stopLoop();
                score = 1234;
                lives = 1;
                const cat = cats[0];
                cat.mode = 'chase';
                cat.r = player.r; cat.c = player.c; cat.prog = 0;
                checkCats();
                return { lives, state, stored: localStorage.getItem('sparrows-garden-best') };
            });
            expect(res.lives).toBe(0);
            expect(res.state).toBe('gameover');
            expect(res.stored).toBe('1234');
            await expect(page.locator('#overlay')).toHaveClass(/visible/);
            await expect(page.locator('#best')).toHaveText('1234');
        });

        test('a shy cat that the sparrow reaches scampers home', async ({ page }) => {
            const res = await page.evaluate(() => {
                startGame(); stopLoop();
                makeCatsShy();
                const cat = cats[0];
                cat.r = player.r; cat.c = player.c; cat.prog = 0;
                checkCats();
                return {
                    lives, score, mode: cat.mode,
                    home: [cat.r === cat.start.r, cat.c === cat.start.c],
                };
            });
            expect(res.lives).toBe(3);
            expect(res.score).toBe(200);
            expect(res.mode).toBe('home');
            expect(res.home).toEqual([true, true]);
        });

        test('the shoo chain pays 200, 400, 800 and 1600', async ({ page }) => {
            const gains = await page.evaluate(() => {
                startGame(); stopLoop();
                makeCatsShy();
                const out = [];
                for (const cat of cats) {
                    const before = score;
                    cat.r = player.r; cat.c = player.c; cat.prog = 0;
                    checkCats();
                    out.push(score - before);
                }
                return out;
            });
            expect(gains).toEqual([200, 400, 800, 1600]);
        });

        test('the chain starts again with the next sunflower', async ({ page }) => {
            const gains = await page.evaluate(() => {
                startGame(); stopLoop();
                const out = [];
                for (let i = 0; i < 2; i++) {
                    makeCatsShy();
                    const cat = cats[i];
                    const before = score;
                    cat.r = player.r; cat.c = player.c; cat.prog = 0;
                    checkCats();
                    out.push(score - before);
                }
                return out;
            });
            expect(gains).toEqual([200, 200]);
        });

        test('a cat in the shed is harmless and comes back out', async ({ page }) => {
            const res = await page.evaluate(() => {
                startGame(); stopLoop();
                const cat = cats[0];
                cat.mode = 'home';
                cat.homeTimer = HOME_MS;
                cat.r = player.r; cat.c = player.c; cat.prog = 0;
                checkCats();
                const livesWhileHome = lives;
                cat.r = cat.start.r; cat.c = cat.start.c;
                tick(HOME_MS + 50);
                return { livesWhileHome, mode: cat.mode };
            });
            expect(res.livesWhileHome).toBe(3);
            expect(res.mode).not.toBe('home');
        });

        test('a cat cannot slip past the sparrow head-on', async ({ page }) => {
            const res = await page.evaluate(() => {
                startGame(); stopLoop();
                cats = cats.slice(0, 1);
                const cat = cats[0];
                cat.mode = 'chase';
                cat.r = 19; cat.c = 7; cat.prog = 0; cat.dir = { dr: 0, dc: 1 };
                player.r = 19; player.c = 9; player.prog = 0;
                player.want = { dr: 0, dc: -1 };
                for (let i = 0; i < 30; i++) tick(16);
                return { lives, caught: lives < 3 };
            });
            expect(res.caught).toBe(true);
        });
    });

    // -----------------------------------------------------------------------
    // Clearing the garden
    // -----------------------------------------------------------------------
    test.describe('clearing the garden', () => {
        test('pecking the last seed lays out a fresh, faster garden', async ({ page }) => {
            const res = await page.evaluate(() => {
                startGame(); stopLoop();
                cats = [];
                const speedBefore = catSpeed();
                // Clear everything but the cell to the sparrow's left.
                for (let r = 0; r < grid.length; r++) {
                    for (let c = 0; c < grid[0].length; c++) {
                        if (grid[r][c] === SEED || grid[r][c] === SUNFLOWER) grid[r][c] = PATH;
                    }
                }
                grid[19][8] = SEED;
                seedsLeft = 1;
                score = 500;
                player.want = { dr: 0, dc: -1 };
                tick(1000 / PLAYER_SPEED);
                return {
                    level, score, seedsLeft, speedBefore, speedAfter: catSpeed(),
                    state, r: player.r, c: player.c, sr: playerStart.r, sc: playerStart.c,
                };
            });
            expect(res.level).toBe(2);
            expect(res.seedsLeft).toBe(204);
            expect(res.score).toBe(510);
            expect(res.state).toBe('playing');
            expect([res.r, res.c]).toEqual([res.sr, res.sc]);
            expect(res.speedAfter).toBeGreaterThan(res.speedBefore);
        });

        test('the level shown in the HUD goes up', async ({ page }) => {
            await page.evaluate(() => {
                startGame(); stopLoop();
                cats = [];
                for (let r = 0; r < grid.length; r++) {
                    for (let c = 0; c < grid[0].length; c++) {
                        if (grid[r][c] === SEED || grid[r][c] === SUNFLOWER) grid[r][c] = PATH;
                    }
                }
                grid[19][8] = SEED;
                seedsLeft = 1;
                player.want = { dr: 0, dc: -1 };
                tick(1000 / PLAYER_SPEED);
            });
            await expect(page.locator('#level')).toHaveText('2');
        });

        test('shyness is shorter in a later garden', async ({ page }) => {
            const res = await page.evaluate(() => {
                const first = sunflowerMs(1);
                return { first, later: sunflowerMs(5), floor: sunflowerMs(40) };
            });
            expect(res.later).toBeLessThan(res.first);
            expect(res.floor).toBeGreaterThanOrEqual(2500);
        });

        test('the cats never outrun their cap', async ({ page }) => {
            expect(await page.evaluate(() => {
                level = 40;
                return catSpeed();
            })).toBeLessThanOrEqual(6.5);
        });
    });

    // -----------------------------------------------------------------------
    // Best score
    // -----------------------------------------------------------------------
    test.describe('best score', () => {
        test('a stored best is shown on load', async ({ page }) => {
            await page.addInitScript(() => localStorage.setItem('sparrows-garden-best', '4200'));
            await page.goto(GAME_URL);
            await expect(page.locator('#best')).toHaveText('4200');
        });

        test('a lower score does not replace the stored best', async ({ page }) => {
            await page.addInitScript(() => localStorage.setItem('sparrows-garden-best', '4200'));
            await page.goto(GAME_URL);
            const stored = await page.evaluate(() => {
                startGame(); stopLoop();
                score = 100;
                lives = 1;
                const cat = cats[0];
                cat.mode = 'chase';
                cat.r = player.r; cat.c = player.c; cat.prog = 0;
                checkCats();
                return localStorage.getItem('sparrows-garden-best');
            });
            expect(stored).toBe('4200');
        });

        test('restarting after game over clears the board and the score', async ({ page }) => {
            const res = await page.evaluate(() => {
                startGame(); stopLoop();
                score = 900; lives = 1; level = 3;
                const cat = cats[0];
                cat.mode = 'chase';
                cat.r = player.r; cat.c = player.c; cat.prog = 0;
                checkCats();
                startGame(); stopLoop();
                return { state, score, lives, level, seedsLeft };
            });
            expect(res).toEqual({ state: 'playing', score: 0, lives: 3, level: 1, seedsLeft: 204 });
        });
    });

    // -----------------------------------------------------------------------
    // Presentation
    // -----------------------------------------------------------------------
    test.describe('presentation', () => {
        test('the title and the Matthew verse are on the page', async ({ page }) => {
            await expect(page.locator('h1')).toHaveText("Sparrow's Garden");
            await expect(page.locator('#verse')).toContainText('Matthew 10:29');
        });

        test('the canvas is actually painted', async ({ page }) => {
            const painted = await page.evaluate(() => {
                const ctx2 = document.getElementById('canvas').getContext('2d');
                const data = ctx2.getImageData(0, 0, canvas.width, canvas.height).data;
                const seen = new Set();
                for (let i = 0; i < data.length; i += 4) {
                    seen.add(data[i] + ',' + data[i + 1] + ',' + data[i + 2]);
                    if (seen.size > 3) return true;
                }
                return false;
            });
            expect(painted).toBe(true);
        });

        test('the rules mention seeds, sunflowers and the cats', async ({ page }) => {
            const text = (await page.locator('#rules').innerText()).toLowerCase();
            expect(text).toContain('seed');
            expect(text).toContain('sunflower');
            expect(text).toContain('cat');
        });
    });
});
