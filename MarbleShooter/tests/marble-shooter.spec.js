const { test, expect } = require('@playwright/test');
const path = require('path');
const { pathToFileURL } = require('url');

const GAME_URL = pathToFileURL(path.resolve(__dirname, '../index.html')).href;

test.describe('Marble Shooter', () => {
    test.beforeEach(async ({ page }) => {
        await page.goto(GAME_URL);
    });

    // -----------------------------------------------------------------------
    // Initial / idle state
    // -----------------------------------------------------------------------
    test.describe('initial state', () => {
        test('page title is Marble Shooter', async ({ page }) => {
            await expect(page).toHaveTitle('Marble Shooter');
        });

        test('start overlay is visible', async ({ page }) => {
            await expect(page.locator('#overlay')).toHaveClass(/visible/);
        });

        test('overlay prompts the player to start', async ({ page }) => {
            await expect(page.locator('#overlay-sub')).toContainText(/space|start/i);
        });

        test('score, level and best have their starting values', async ({ page }) => {
            await expect(page.locator('#score')).toHaveText('0');
            await expect(page.locator('#level')).toHaveText('1');
            await expect(page.locator('#best')).toHaveText('0');
        });

        test('canvas is 600x400', async ({ page }) => {
            const canvas = page.locator('#canvas');
            await expect(canvas).toHaveAttribute('width', '600');
            await expect(canvas).toHaveAttribute('height', '400');
        });

        test('state is idle before starting', async ({ page }) => {
            expect(await page.evaluate(() => state)).toBe('idle');
        });

        test('no marbles and no shots before starting', async ({ page }) => {
            const counts = await page.evaluate(() => ({ m: marbles.length, s: shots.length }));
            expect(counts).toEqual({ m: 0, s: 0 });
        });

        test('best score loads from localStorage', async ({ page }) => {
            await page.evaluate(() => window.localStorage.setItem('marble-shooter-best', '4210'));
            await page.reload();
            await expect(page.locator('#best')).toHaveText('4210');
        });
    });

    // -----------------------------------------------------------------------
    // Track geometry
    // -----------------------------------------------------------------------
    test.describe('track', () => {
        test('the track has a usable length', async ({ page }) => {
            expect(await page.evaluate(() => pathLength)).toBeGreaterThan(1000);
        });

        test('every track point lies inside the canvas', async ({ page }) => {
            const inside = await page.evaluate(() => PATH.every(
                (p) => p.x >= 0 && p.x <= CANVAS_W && p.y >= 0 && p.y <= CANVAS_H));
            expect(inside).toBe(true);
        });

        test('the track is continuous — no jumps between samples', async ({ page }) => {
            const maxGap = await page.evaluate(() => {
                let worst = 0;
                for (let i = 1; i < PATH.length; i++) {
                    worst = Math.max(worst, Math.hypot(PATH[i].x - PATH[i - 1].x, PATH[i].y - PATH[i - 1].y));
                }
                return worst;
            });
            expect(maxGap).toBeLessThan(5);
        });

        test('pathPointAt clamps outside the track', async ({ page }) => {
            const p = await page.evaluate(() => ({
                before: pathPointAt(-100),
                first: pathPointAt(0),
                after: pathPointAt(pathLength + 500),
                last: pathPointAt(pathLength),
            }));
            expect(p.before).toEqual(p.first);
            expect(p.after).toEqual(p.last);
        });

        test('the track ends at the hole', async ({ page }) => {
            const d = await page.evaluate(() => {
                const end = pathPointAt(pathLength);
                return Math.hypot(end.x - hole.x, end.y - hole.y);
            });
            expect(d).toBeLessThan(1);
        });

        test('the cannon sits clear of the innermost coil', async ({ page }) => {
            const clear = await page.evaluate(() => PATH.every(
                (p) => Math.hypot(p.x - shooter.x, p.y - shooter.y) > MARBLE_R + 18));
            expect(clear).toBe(true);
        });

        test('nearestPathDist recovers the distance of a point on the track', async ({ page }) => {
            const err = await page.evaluate(() => {
                const target = pathLength * 0.4;
                const p = pathPointAt(target);
                return Math.abs(nearestPathDist(p.x, p.y, target) - target);
            });
            expect(err).toBeLessThan(3);
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

        test('a new game starts on level 1 with no score', async ({ page }) => {
            const s = await page.evaluate(() => { startGame(); return { level, score, state }; });
            expect(s).toEqual({ level: 1, score: 0, state: 'running' });
        });

        test('the level 1 chain has the expected number of marbles', async ({ page }) => {
            const s = await page.evaluate(() => {
                startGame();
                return { n: marbles.length, want: levelMarbleCount(1) };
            });
            expect(s.n).toBe(s.want);
        });

        test('the chain starts at the mouth of the track', async ({ page }) => {
            const head = await page.evaluate(() => { startGame(); return headDist; });
            expect(head).toBeLessThanOrEqual(0);
        });

        test('the generated chain never contains a ready-made run of three', async ({ page }) => {
            const worst = await page.evaluate(() => {
                let worst = 0;
                for (let attempt = 0; attempt < 25; attempt++) {
                    startGame();
                    let run = 1;
                    for (let i = 1; i < marbles.length; i++) {
                        run = marbles[i].color === marbles[i - 1].color ? run + 1 : 1;
                        worst = Math.max(worst, run);
                    }
                }
                return worst;
            });
            expect(worst).toBeLessThan(3);
        });

        test('the chain only uses the colours allowed at this level', async ({ page }) => {
            const ok = await page.evaluate(() => {
                startGame();
                return marbles.every((m) => Number.isInteger(m.color) && m.color >= 0 && m.color < colorCount());
            });
            expect(ok).toBe(true);
        });

        test('the cannon is loaded with a colour that is in the chain', async ({ page }) => {
            const ok = await page.evaluate(() => {
                startGame();
                const present = new Set(marbles.map((m) => m.color));
                return present.has(shooter.current) && present.has(shooter.next);
            });
            expect(ok).toBe(true);
        });

        test('the marbles-remaining readout matches the chain', async ({ page }) => {
            const n = await page.evaluate(() => { startGame(); return marbles.length; });
            await expect(page.locator('#marbles')).toHaveText(String(n));
        });
    });

    // -----------------------------------------------------------------------
    // Chain movement
    // -----------------------------------------------------------------------
    test.describe('chain movement', () => {
        test('the chain crawls toward the hole', async ({ page }) => {
            const moved = await page.evaluate(() => {
                startGame();
                const before = headDist;
                for (let i = 0; i < 60; i++) step(0.016);
                return headDist - before;
            });
            expect(moved).toBeGreaterThan(0);
        });

        test('marbles are spaced evenly behind the head', async ({ page }) => {
            const r = await page.evaluate(() => {
                startGame();
                setChain([0, 1, 2], 400);
                return { a: marbleDist(0) - marbleDist(1), b: marbleDist(1) - marbleDist(2), spacing: SPACING };
            });
            expect(r.a).toBeCloseTo(r.spacing, 6);
            expect(r.b).toBeCloseTo(r.spacing, 6);
        });

        test('marblePos follows the track', async ({ page }) => {
            const off = await page.evaluate(() => {
                startGame();
                setChain([0, 1, 2], 500);
                const p = marblePos(1);
                const q = pathPointAt(marbleDist(1));
                return Math.hypot(p.x - q.x, p.y - q.y);
            });
            expect(off).toBeLessThan(0.001);
        });

        test('the chain moves faster at higher levels', async ({ page }) => {
            const speeds = await page.evaluate(() => {
                startGame();
                level = 1;
                const slow = chainSpeed();
                level = 5;
                return { slow, fast: chainSpeed() };
            });
            expect(speeds.fast).toBeGreaterThan(speeds.slow);
        });

        test('the head reaching the hole ends the game', async ({ page }) => {
            const s = await page.evaluate(() => {
                startGame();
                headDist = pathLength - 1;
                for (let i = 0; i < 120; i++) step(0.016);
                return state;
            });
            expect(s).toBe('over');
        });
    });

    // -----------------------------------------------------------------------
    // Aiming
    // -----------------------------------------------------------------------
    test.describe('aiming', () => {
        test('setAim sets the cannon angle', async ({ page }) => {
            const a = await page.evaluate(() => { startGame(); setAim(1.25); return shooter.angle; });
            expect(a).toBeCloseTo(1.25, 6);
        });

        test('aimAt points the cannon at a target', async ({ page }) => {
            const a = await page.evaluate(() => {
                startGame();
                aimAt(shooter.x + 100, shooter.y);
                return shooter.angle;
            });
            expect(Math.cos(a)).toBeCloseTo(1, 5);
        });

        test('ArrowLeft and ArrowRight rotate the cannon', async ({ page }) => {
            await page.evaluate(() => { startGame(); setAim(0); });
            await page.keyboard.down('ArrowRight');
            await page.evaluate(() => { for (let i = 0; i < 10; i++) step(0.016); });
            await page.keyboard.up('ArrowRight');
            const right = await page.evaluate(() => shooter.angle);
            expect(right).toBeGreaterThan(0);

            await page.keyboard.down('ArrowLeft');
            await page.evaluate(() => { for (let i = 0; i < 20; i++) step(0.016); });
            await page.keyboard.up('ArrowLeft');
            const left = await page.evaluate(() => shooter.angle);
            expect(left).toBeLessThan(right);
        });
    });

    // -----------------------------------------------------------------------
    // Firing
    // -----------------------------------------------------------------------
    test.describe('firing', () => {
        test('fire launches the loaded marble', async ({ page }) => {
            const shot = await page.evaluate(() => {
                startGame();
                setChain([0, 1, 2], 100);
                shooter.current = 2;
                setAim(0);
                fire();
                return { n: shots.length, color: shots[0].color };
            });
            expect(shot.n).toBe(1);
            expect(shot.color).toBe(2);
        });

        test('firing advances the queue', async ({ page }) => {
            const cur = await page.evaluate(() => {
                startGame();
                shooter.current = 0;
                shooter.next = 1;
                fire();
                return shooter.current;
            });
            expect(cur).toBe(1);
        });

        test('a shot travels in the direction the cannon is aimed', async ({ page }) => {
            const delta = await page.evaluate(() => {
                startGame();
                setChain([0], -500);
                setAim(0);
                fire();
                const x0 = shots[0].x;
                for (let i = 0; i < 5; i++) step(0.016);
                return shots[0].x - x0;
            });
            expect(delta).toBeGreaterThan(0);
        });

        test('the cooldown blocks an instant second shot', async ({ page }) => {
            const n = await page.evaluate(() => {
                startGame();
                setChain([0], -500);
                fire();
                fire();
                return shots.length;
            });
            expect(n).toBe(1);
        });

        test('after the cooldown the cannon can fire again', async ({ page }) => {
            const n = await page.evaluate(() => {
                startGame();
                setChain([0], -500);
                setAim(0);
                fire();
                for (let i = 0; i < 20; i++) step(0.016);
                fire();
                return shots.length;
            });
            expect(n).toBe(2);
        });

        test('a shot that misses everything leaves the board', async ({ page }) => {
            const n = await page.evaluate(() => {
                startGame();
                setChain([0], -5000);
                setAim(0);
                fire();
                for (let i = 0; i < 120; i++) step(0.016);
                return shots.length;
            });
            expect(n).toBe(0);
        });

        test('the cannon cannot fire while paused', async ({ page }) => {
            const n = await page.evaluate(() => {
                startGame();
                setChain([0], -500);
                togglePause();
                fire();
                return shots.length;
            });
            expect(n).toBe(0);
        });

        test('S swaps the loaded and next marbles', async ({ page }) => {
            await page.evaluate(() => { startGame(); shooter.current = 0; shooter.next = 3; });
            await page.keyboard.press('s');
            const s = await page.evaluate(() => ({ cur: shooter.current, next: shooter.next }));
            expect(s).toEqual({ cur: 3, next: 0 });
        });
    });

    // -----------------------------------------------------------------------
    // Inserting into the chain
    // -----------------------------------------------------------------------
    test.describe('insertion', () => {
        test('a shot that reaches the chain is inserted into it', async ({ page }) => {
            const r = await page.evaluate(() => {
                startGame();
                setChain([0, 1, 2, 3, 0, 1], pathLength * 0.5);
                const target = marblePos(3);
                aimAt(target.x, target.y);
                shooter.current = 2;
                fire();
                for (let i = 0; i < 600 && shots.length; i++) step(0.001);
                return { marbles: marbles.length, shots: shots.length };
            });
            expect(r.marbles).toBe(7);
            expect(r.shots).toBe(0);
        });

        test('inserting pushes the marbles behind it further from the hole', async ({ page }) => {
            const r = await page.evaluate(() => {
                startGame();
                setChain([0, 1, 2], 600);
                const before = marbleDist(2);
                insertMarble(1, 3);
                return { before, after: marbleDist(3), front: marbleDist(0) };
            });
            expect(r.after).toBeLessThan(r.before);
            expect(r.front).toBe(600);
        });

        test('inserting at the front advances the head by one slot', async ({ page }) => {
            const r = await page.evaluate(() => {
                startGame();
                setChain([0, 1, 2], 600);
                insertMarble(0, 3);
                return { head: headDist, second: marbleDist(1), spacing: SPACING };
            });
            expect(r.head).toBe(600 + r.spacing);
            expect(r.second).toBe(600);
        });
    });

    // -----------------------------------------------------------------------
    // Matching
    // -----------------------------------------------------------------------
    test.describe('matching', () => {
        test('three in a row pop', async ({ page }) => {
            const r = await page.evaluate(() => {
                startGame();
                setChain([1, 2, 2, 3, 4], 600);
                insertMarble(3, 2);                     // 1 2 2 2 3 4
                const colors = marbles.map((m) => m.color);
                return { colors, removed: resolveMatches(3) };
            });
            expect(r.colors).toEqual([1, 2, 2, 2, 3, 4]);
            expect(r.removed).toBe(3);
        });

        test('a popped run leaves the rest of the chain behind', async ({ page }) => {
            const colors = await page.evaluate(() => {
                startGame();
                setChain([1, 2, 2, 3, 4], 600);
                insertMarble(3, 2);
                resolveMatches(3);
                return marbles.map((m) => m.color);
            });
            expect(colors).toEqual([1, 3, 4]);
        });

        test('two in a row do not pop', async ({ page }) => {
            const r = await page.evaluate(() => {
                startGame();
                setChain([1, 2, 3, 4], 600);
                insertMarble(2, 2);                     // 1 2 2 3 4
                return { removed: resolveMatches(2), n: marbles.length };
            });
            expect(r.removed).toBe(0);
            expect(r.n).toBe(5);
        });

        test('popping scores points', async ({ page }) => {
            const r = await page.evaluate(() => {
                startGame();
                setChain([1, 2, 2, 3, 4], 600);
                score = 0;
                insertMarble(3, 2);
                resolveMatches(3);
                return { score, base: POINTS_PER_MARBLE };
            });
            expect(r.score).toBe(3 * r.base);
        });

        test('the rear closes the gap after a pop', async ({ page }) => {
            const r = await page.evaluate(() => {
                startGame();
                setChain([1, 2, 2, 2, 4], 600);
                const frontBefore = marbleDist(0);
                resolveMatches(2);
                return {
                    frontBefore,
                    frontAfter: marbleDist(0),
                    nextAfter: marbleDist(1),
                    spacing: SPACING,
                    colors: marbles.map((m) => m.color),
                };
            });
            expect(r.colors).toEqual([1, 4]);
            expect(r.frontAfter).toBe(r.frontBefore);
            expect(r.nextAfter).toBe(r.frontBefore - r.spacing);
        });

        test('popping the front of the chain leaves the survivors in place', async ({ page }) => {
            const r = await page.evaluate(() => {
                startGame();
                setChain([2, 2, 2, 4, 5], 600);
                const survivor = marbleDist(3);
                resolveMatches(0);
                return { survivor, after: marbleDist(0), colors: marbles.map((m) => m.color) };
            });
            expect(r.colors).toEqual([4, 5]);
            expect(r.after).toBeCloseTo(r.survivor, 6);
        });

        test('a cascade pops the seam too and pays a combo bonus', async ({ page }) => {
            const r = await page.evaluate(() => {
                startGame();
                setChain([1, 1, 2, 2, 1, 1], 600);
                score = 0;
                insertMarble(2, 2);                     // 1 1 2 2 2 1 1
                const removed = resolveMatches(2);
                return { removed, left: marbles.length, score, base: POINTS_PER_MARBLE };
            });
            expect(r.removed).toBe(7);
            expect(r.left).toBe(0);
            // three marbles at combo 1, then four more at combo 2
            expect(r.score).toBe(3 * r.base + 4 * r.base * 2);
        });

        test('a shot of a matching colour pops on impact', async ({ page }) => {
            const r = await page.evaluate(() => {
                startGame();
                setChain([0, 1, 1, 2, 3, 4], pathLength * 0.5);
                const target = marblePos(2);
                aimAt(target.x, target.y);
                shooter.current = 1;
                fire();
                for (let i = 0; i < 600 && shots.length; i++) step(0.001);
                return { n: marbles.length, colors: marbles.map((m) => m.color) };
            });
            expect(r.n).toBe(4);
            expect(r.colors).not.toContain(1);
        });
    });

    // -----------------------------------------------------------------------
    // Levels
    // -----------------------------------------------------------------------
    test.describe('levels', () => {
        test('clearing the chain advances the level and deals a new one', async ({ page }) => {
            const r = await page.evaluate(() => {
                startGame();
                setChain([2, 2, 2], 600);
                resolveMatches(0);
                step(0.016);
                return { level, n: marbles.length, want: levelMarbleCount(2) };
            });
            expect(r.level).toBe(2);
            expect(r.n).toBe(r.want);
        });

        test('clearing the chain pays a level bonus', async ({ page }) => {
            const r = await page.evaluate(() => {
                startGame();
                setChain([2, 2, 2], 600);
                resolveMatches(0);
                score = 0;
                step(0.016);
                return { score, bonus: LEVEL_BONUS };
            });
            expect(r.score).toBe(r.bonus);
        });

        test('the new chain restarts at the mouth of the track', async ({ page }) => {
            const head = await page.evaluate(() => {
                startGame();
                setChain([2, 2, 2], 600);
                resolveMatches(0);
                step(0.016);
                return headDist;
            });
            expect(head).toBeLessThanOrEqual(1);
        });

        test('later levels use more colours and more marbles, up to their caps', async ({ page }) => {
            const r = await page.evaluate(() => {
                startGame();
                level = 1;
                const a = { colors: colorCount(), n: levelMarbleCount(level) };
                level = 3;
                const b = { colors: colorCount(), n: levelMarbleCount(level) };
                level = 30;
                const c = { colors: colorCount(), n: levelMarbleCount(level) };
                return { a, b, c, max: COLORS.length };
            });
            expect(r.b.colors).toBeGreaterThan(r.a.colors);
            expect(r.b.n).toBeGreaterThan(r.a.n);
            expect(r.c.colors).toBe(r.max);
            expect(r.c.n).toBeLessThanOrEqual(48);
        });
    });

    // -----------------------------------------------------------------------
    // Scoring, pausing and restarting
    // -----------------------------------------------------------------------
    test.describe('scoring', () => {
        test('best score updates on game over when beaten', async ({ page }) => {
            await page.evaluate(() => { startGame(); score = 777; updateHud(); endGame(); });
            await expect(page.locator('#best')).toHaveText('777');
        });

        test('best score persists to localStorage', async ({ page }) => {
            await page.evaluate(() => { startGame(); score = 512; updateHud(); endGame(); });
            const stored = await page.evaluate(() => window.localStorage.getItem('marble-shooter-best'));
            expect(parseInt(stored, 10)).toBe(512);
        });

        test('best score is not lowered by a worse run', async ({ page }) => {
            await page.evaluate(() => window.localStorage.setItem('marble-shooter-best', '9000'));
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

    test.describe('pause and restart', () => {
        test('pausing freezes the chain', async ({ page }) => {
            const r = await page.evaluate(() => {
                startGame();
                togglePause();
                const before = headDist;
                for (let i = 0; i < 30; i++) step(0.016);
                return { before, after: headDist, state };
            });
            expect(r.state).toBe('paused');
            expect(r.after).toBe(r.before);
        });

        test('resuming lets the chain crawl again', async ({ page }) => {
            const moved = await page.evaluate(() => {
                startGame();
                togglePause();
                togglePause();
                const before = headDist;
                for (let i = 0; i < 30; i++) step(0.016);
                return headDist > before;
            });
            expect(moved).toBe(true);
        });

        test('P toggles pause', async ({ page }) => {
            await page.evaluate(() => startGame());
            await page.keyboard.press('p');
            expect(await page.evaluate(() => state)).toBe('paused');
            await page.keyboard.press('p');
            expect(await page.evaluate(() => state)).toBe('running');
        });

        test('restarting after game over resets score, level, chain and shots', async ({ page }) => {
            const r = await page.evaluate(() => {
                startGame();
                score = 999;
                level = 7;
                fire();
                endGame();
                startGame();
                return { score, level, shots: shots.length, state, n: marbles.length };
            });
            expect(r.score).toBe(0);
            expect(r.level).toBe(1);
            expect(r.shots).toBe(0);
            expect(r.state).toBe('running');
            expect(r.n).toBeGreaterThan(0);
        });
    });
});
