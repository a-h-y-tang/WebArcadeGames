const { test, expect } = require('@playwright/test');
const path = require('path');
const { pathToFileURL } = require('url');

const GAME_URL = pathToFileURL(path.resolve(__dirname, '../index.html')).href;

test.describe('Marble Chain', () => {
    test.beforeEach(async ({ page }) => {
        await page.goto(GAME_URL);
    });

    // -----------------------------------------------------------------------
    // Initial / idle state
    // -----------------------------------------------------------------------
    test.describe('initial state', () => {
        test('page title is Marble Chain', async ({ page }) => {
            await expect(page).toHaveTitle('Marble Chain');
        });

        test('start overlay is visible', async ({ page }) => {
            await expect(page.locator('#overlay')).toHaveClass(/visible/);
        });

        test('overlay prompts the player to start', async ({ page }) => {
            await expect(page.locator('#overlay-sub')).toContainText(/space|start/i);
        });

        test('score, level and best start at their defaults', async ({ page }) => {
            await expect(page.locator('#score')).toHaveText('0');
            await expect(page.locator('#level')).toHaveText('1');
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

        test('no marbles or projectiles before starting', async ({ page }) => {
            const counts = await page.evaluate(() => ({ b: balls.length, p: projectiles.length }));
            expect(counts).toEqual({ b: 0, p: 0 });
        });

        test('best score loads from localStorage', async ({ page }) => {
            await page.evaluate(() => window.localStorage.setItem('marble-chain-best', '4210'));
            await page.reload();
            await expect(page.locator('#best')).toHaveText('4210');
        });
    });

    // -----------------------------------------------------------------------
    // The track
    // -----------------------------------------------------------------------
    test.describe('path', () => {
        test('the path has a positive length', async ({ page }) => {
            expect(await page.evaluate(() => PATH_LENGTH)).toBeGreaterThan(500);
        });

        test('path start and end are inside the canvas', async ({ page }) => {
            const ends = await page.evaluate(() => [pathPoint(0), pathPoint(PATH_LENGTH)]);
            for (const p of ends) {
                expect(p.x).toBeGreaterThanOrEqual(0);
                expect(p.x).toBeLessThanOrEqual(640);
                expect(p.y).toBeGreaterThanOrEqual(0);
                expect(p.y).toBeLessThanOrEqual(480);
            }
        });

        test('the path is continuous — no jumps between nearby distances', async ({ page }) => {
            const maxJump = await page.evaluate(() => {
                let worst = 0;
                for (let d = 0; d < PATH_LENGTH - 1; d += 1) {
                    const a = pathPoint(d), b = pathPoint(d + 1);
                    worst = Math.max(worst, Math.hypot(b.x - a.x, b.y - a.y));
                }
                return worst;
            });
            expect(maxJump).toBeLessThan(2);
        });

        test('the path never doubles back on itself', async ({ page }) => {
            // Sampling by arc length must advance roughly 1px per unit of distance.
            const shortest = await page.evaluate(() => {
                let worst = Infinity;
                for (let d = 0; d < PATH_LENGTH - 1; d += 1) {
                    const a = pathPoint(d), b = pathPoint(d + 1);
                    worst = Math.min(worst, Math.hypot(b.x - a.x, b.y - a.y));
                }
                return worst;
            });
            expect(shortest).toBeGreaterThan(0.5);
        });

        test('distances before the spawner extrapolate backwards', async ({ page }) => {
            const { start, behind } = await page.evaluate(() => ({
                start: pathPoint(0),
                behind: pathPoint(-60),
            }));
            expect(Number.isFinite(behind.x)).toBe(true);
            expect(Math.hypot(behind.x - start.x, behind.y - start.y)).toBeGreaterThan(50);
        });

        test('the tangent is a unit vector pointing along the path', async ({ page }) => {
            const t = await page.evaluate(() => {
                const a = pathPoint(200), b = pathPoint(205), tan = pathTangent(200);
                return {
                    len: Math.hypot(tan.x, tan.y),
                    dot: (b.x - a.x) * tan.x + (b.y - a.y) * tan.y,
                };
            });
            expect(t.len).toBeCloseTo(1, 2);
            expect(t.dot).toBeGreaterThan(0);
        });
    });

    // -----------------------------------------------------------------------
    // Starting
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

        test('the game starts on level 1 with a zero score', async ({ page }) => {
            const s = await page.evaluate(() => { startGame(); return { level, score, state }; });
            expect(s).toEqual({ level: 1, score: 0, state: 'running' });
        });

        test('the turret is loaded with a marble and a preview', async ({ page }) => {
            const s = await page.evaluate(() => {
                startGame();
                return { color: shooter.color, next: shooter.next, palette: COLORS.length };
            });
            expect(s.color).toBeGreaterThanOrEqual(0);
            expect(s.color).toBeLessThan(s.palette);
            expect(s.next).toBeGreaterThanOrEqual(0);
            expect(s.next).toBeLessThan(s.palette);
        });

        test('marbles start rolling onto the track', async ({ page }) => {
            const n = await page.evaluate(() => {
                startGame();
                for (let i = 0; i < 400; i++) step(0.016);
                return balls.length;
            });
            expect(n).toBeGreaterThan(3);
        });

        test('the level has a finite supply of marbles', async ({ page }) => {
            const remaining = await page.evaluate(() => { startGame(); return spawnRemaining; });
            expect(remaining).toBeGreaterThan(10);
        });
    });

    // -----------------------------------------------------------------------
    // Chain movement
    // -----------------------------------------------------------------------
    test.describe('the chain', () => {
        test('marbles advance along the track over time', async ({ page }) => {
            const { before, after } = await page.evaluate(() => {
                startGame();
                setChain([0, 1, 2], 400);
                const before = balls[0].dist;
                for (let i = 0; i < 30; i++) step(0.016);
                return { before, after: balls[0].dist };
            });
            expect(after).toBeGreaterThan(before);
        });

        test('a packed chain keeps exactly one spacing between marbles', async ({ page }) => {
            const gaps = await page.evaluate(() => {
                startGame();
                spawnRemaining = 0;
                setChain([0, 1, 2, 0], 400);
                for (let i = 0; i < 30; i++) step(0.016);
                return balls.slice(1).map((b, i) => balls[i].dist - b.dist);
            });
            for (const g of gaps) expect(g).toBeCloseTo(26, 1);
        });

        test('the chain is always ordered front-to-back by distance', async ({ page }) => {
            const ordered = await page.evaluate(() => {
                startGame();
                for (let i = 0; i < 600; i++) step(0.016);
                return balls.every((b, i) => i === 0 || balls[i - 1].dist > b.dist);
            });
            expect(ordered).toBe(true);
        });

        test('a gap behind a burst closes as the rear marbles roll forward', async ({ page }) => {
            const { before, after } = await page.evaluate(() => {
                startGame();
                setChain([0, 1], 400);
                balls[1].dist = 200;              // open a large gap
                const before = balls[0].dist - balls[1].dist;
                for (let i = 0; i < 120; i++) step(0.016);
                return { before, after: balls[0].dist - balls[1].dist };
            });
            expect(before).toBeGreaterThan(100);
            expect(after).toBeLessThan(before);
        });

        test('rear marbles never overrun the marble ahead while closing a gap', async ({ page }) => {
            const minGap = await page.evaluate(() => {
                startGame();
                setChain([0, 1], 400);
                balls[1].dist = 200;
                let worst = Infinity;
                for (let i = 0; i < 400; i++) {
                    step(0.016);
                    if (balls.length > 1) worst = Math.min(worst, balls[0].dist - balls[1].dist);
                }
                return worst;
            });
            expect(minGap).toBeGreaterThanOrEqual(25.9);
        });

        test('the chain moves faster on later levels', async ({ page }) => {
            const { slow, fast } = await page.evaluate(() => {
                startGame();
                level = 1;
                const slow = chainSpeed();
                level = 6;
                const fast = chainSpeed();
                return { slow, fast };
            });
            expect(fast).toBeGreaterThan(slow);
        });
    });

    // -----------------------------------------------------------------------
    // Aiming and firing
    // -----------------------------------------------------------------------
    test.describe('the turret', () => {
        test('aiming at a point turns the turret toward it', async ({ page }) => {
            const ok = await page.evaluate(() => {
                startGame();
                aimAt(shooter.x + 100, shooter.y - 100);
                const dir = { x: Math.cos(shooter.angle), y: Math.sin(shooter.angle) };
                return dir.x > 0.5 && dir.y < -0.5;
            });
            expect(ok).toBe(true);
        });

        test('aim is clamped so the turret cannot fire downward', async ({ page }) => {
            const dirs = await page.evaluate(() => {
                startGame();
                aimAt(shooter.x, shooter.y + 200);       // straight down
                const down = Math.sin(shooter.angle);
                aimAt(shooter.x - 10, shooter.y + 200);  // down and left
                const downLeft = Math.sin(shooter.angle);
                return { down, downLeft };
            });
            expect(dirs.down).toBeLessThan(0);
            expect(dirs.downLeft).toBeLessThan(0);
        });

        test('ArrowLeft rotates the turret counter-clockwise', async ({ page }) => {
            const { before, after } = await page.evaluate(() => {
                startGame();
                aimAt(shooter.x, shooter.y - 100);
                const before = shooter.angle;
                setAimDir(-1);
                for (let i = 0; i < 10; i++) step(0.016);
                return { before, after: shooter.angle };
            });
            expect(after).toBeLessThan(before);
        });

        test('the ArrowRight key rotates the turret clockwise', async ({ page }) => {
            await page.evaluate(() => { startGame(); aimAt(shooter.x, shooter.y - 100); });
            const before = await page.evaluate(() => shooter.angle);
            await page.keyboard.down('ArrowRight');
            await page.evaluate(() => { for (let i = 0; i < 10; i++) step(0.016); });
            await page.keyboard.up('ArrowRight');
            expect(await page.evaluate(() => shooter.angle)).toBeGreaterThan(before);
        });

        test('firing launches a projectile carrying the loaded colour', async ({ page }) => {
            const r = await page.evaluate(() => {
                startGame();
                const color = shooter.color;
                fire();
                return { n: projectiles.length, color, shot: projectiles[0].color };
            });
            expect(r.n).toBe(1);
            expect(r.shot).toBe(r.color);
        });

        test('firing promotes the preview marble into the turret', async ({ page }) => {
            const r = await page.evaluate(() => {
                startGame();
                const next = shooter.next;
                fire();
                return { next, loaded: shooter.color };
            });
            expect(r.loaded).toBe(r.next);
        });

        test('swapping exchanges the loaded and preview marbles', async ({ page }) => {
            const r = await page.evaluate(() => {
                startGame();
                shooter.color = 0;
                shooter.next = 1;
                swapNext();
                return { color: shooter.color, next: shooter.next };
            });
            expect(r).toEqual({ color: 1, next: 0 });
        });

        test('a projectile travels along the aim direction', async ({ page }) => {
            const moved = await page.evaluate(() => {
                startGame();
                balls.length = 0;
                spawnRemaining = 0;
                aimAt(shooter.x, shooter.y - 100);
                fire();
                const y0 = projectiles[0].y;
                step(0.05);
                return y0 - projectiles[0].y;
            });
            expect(moved).toBeGreaterThan(0);
        });

        test('a projectile that leaves the canvas is discarded', async ({ page }) => {
            const n = await page.evaluate(() => {
                startGame();
                balls.length = 0;
                spawnRemaining = 0;
                aimAt(shooter.x, shooter.y - 100);
                fire();
                for (let i = 0; i < 120; i++) step(0.016);
                return projectiles.length;
            });
            expect(n).toBe(0);
        });

        test('the reload cooldown prevents firing twice in the same instant', async ({ page }) => {
            const n = await page.evaluate(() => {
                startGame();
                fire();
                fire();
                return projectiles.length;
            });
            expect(n).toBe(1);
        });

        test('the turret reloads after the cooldown elapses', async ({ page }) => {
            const n = await page.evaluate(() => {
                startGame();
                balls.length = 0;
                spawnRemaining = 0;
                fire();
                for (let i = 0; i < 60; i++) step(0.016);
                fire();
                return projectiles.length;
            });
            expect(n).toBeGreaterThan(0);
        });

        test('the turret is loaded with a colour that is still on the track', async ({ page }) => {
            const ok = await page.evaluate(() => {
                startGame();
                setChain([2, 2, 2], 400);
                reloadTurret();
                return shooter.color === 2 && shooter.next === 2;
            });
            expect(ok).toBe(true);
        });
    });

    // -----------------------------------------------------------------------
    // Insertion
    // -----------------------------------------------------------------------
    test.describe('insertion', () => {
        test('a projectile that reaches the chain is absorbed into it', async ({ page }) => {
            const r = await page.evaluate(() => {
                startGame();
                spawnRemaining = 0;
                setChain([0, 1, 2], 400);
                const p = pathPoint(balls[1].dist);
                spawnProjectile({ x: p.x, y: p.y + 40, vx: 0, vy: -400, color: 1 });
                for (let i = 0; i < 20; i++) step(0.016);
                return { balls: balls.length, projectiles: projectiles.length };
            });
            expect(r.balls).toBe(4);
            expect(r.projectiles).toBe(0);
        });

        test('a marble landing ahead of its neighbour takes the front slot', async ({ page }) => {
            const colors = await page.evaluate(() => {
                startGame();
                spawnRemaining = 0;
                setChain([0, 1, 2], 400);
                const front = pathPoint(400);
                const tan = pathTangent(400);
                // sitting just in front of the leading marble, moving into it
                spawnProjectile({
                    x: front.x + tan.x * 18, y: front.y + tan.y * 18,
                    vx: -tan.x * 200, vy: -tan.y * 200, color: 3,
                });
                for (let i = 0; i < 10; i++) step(0.016);
                return balls.map((b) => b.color);
            });
            expect(colors[0]).toBe(3);
        });

        test('a marble landing behind its neighbour joins the back', async ({ page }) => {
            const colors = await page.evaluate(() => {
                startGame();
                spawnRemaining = 0;
                setChain([0, 1, 2], 400);
                const tailDist = balls[balls.length - 1].dist;
                const tail = pathPoint(tailDist);
                const tan = pathTangent(tailDist);
                spawnProjectile({
                    x: tail.x - tan.x * 18, y: tail.y - tan.y * 18,
                    vx: tan.x * 200, vy: tan.y * 200, color: 3,
                });
                for (let i = 0; i < 10; i++) step(0.016);
                return balls.map((b) => b.color);
            });
            expect(colors[colors.length - 1]).toBe(3);
        });

        test('inserting pushes the marbles behind it away from the hole', async ({ page }) => {
            const { before, after } = await page.evaluate(() => {
                startGame();
                spawnRemaining = 0;
                setChain([0, 1, 2], 400);
                const before = balls[2].dist;
                insertBall(1, 3);
                return { before, after: balls[balls.length - 1].dist };
            });
            expect(after).toBeCloseTo(before - 26, 5);
        });

        test('inserting keeps the chain sorted', async ({ page }) => {
            const ordered = await page.evaluate(() => {
                startGame();
                spawnRemaining = 0;
                setChain([0, 1, 2, 3], 500);
                insertBall(2, 4);
                insertBall(0, 4);
                insertBall(balls.length, 4);
                return balls.every((b, i) => i === 0 || balls[i - 1].dist > b.dist);
            });
            expect(ordered).toBe(true);
        });

        test('inserting into an empty chain is harmless', async ({ page }) => {
            const n = await page.evaluate(() => {
                startGame();
                balls.length = 0;
                insertBall(0, 1);
                return balls.length;
            });
            expect(n).toBe(1);
        });
    });

    // -----------------------------------------------------------------------
    // Matching
    // -----------------------------------------------------------------------
    test.describe('matching', () => {
        test('three of a colour burst', async ({ page }) => {
            const n = await page.evaluate(() => {
                startGame();
                spawnRemaining = 0;
                setChain([1, 0, 0, 2], 400);
                insertBall(1, 0);          // -> 1,0,0,0,2
                return balls.length;
            });
            expect(n).toBe(2);
        });

        test('a pair does not burst', async ({ page }) => {
            const n = await page.evaluate(() => {
                startGame();
                spawnRemaining = 0;
                setChain([1, 0, 2], 400);
                insertBall(1, 0);          // -> 1,0,0,2
                return balls.length;
            });
            expect(n).toBe(4);
        });

        test('a run longer than three bursts completely', async ({ page }) => {
            const n = await page.evaluate(() => {
                startGame();
                spawnRemaining = 0;
                setChain([1, 0, 0, 0, 0, 2], 500);
                resolveMatches(2);
                return balls.length;
            });
            expect(n).toBe(2);
        });

        test('bursting scores points', async ({ page }) => {
            const score = await page.evaluate(() => {
                startGame();
                spawnRemaining = 0;
                setChain([1, 0, 0, 2], 400);
                insertBall(1, 0);
                return score;
            });
            expect(score).toBeGreaterThan(0);
        });

        test('a bigger burst scores more than a smaller one', async ({ page }) => {
            const { three, five } = await page.evaluate(() => {
                startGame();
                spawnRemaining = 0;
                setChain([1, 0, 0, 0, 2], 500);
                score = 0; combo = 0;
                resolveMatches(2);
                const three = score;
                setChain([1, 0, 0, 0, 0, 0, 2], 500);
                score = 0; combo = 0;
                resolveMatches(3);
                return { three, five: score };
            });
            expect(five).toBeGreaterThan(three);
        });

        test('the combo multiplier resets on every shot', async ({ page }) => {
            const c = await page.evaluate(() => {
                startGame();
                combo = 4;
                fire();
                return combo;
            });
            expect(c).toBe(0);
        });

        test('a second burst in one cascade is worth more than the first', async ({ page }) => {
            const { first, second } = await page.evaluate(() => {
                startGame();
                spawnRemaining = 0;
                combo = 0;
                score = 0;
                setChain([0, 0, 0, 1, 1, 1], 600);
                resolveMatches(0);
                const first = score;
                resolveMatches(0);
                return { first, second: score - first };
            });
            expect(second).toBe(first * 2);
        });

        test('a gap closing into a matching run triggers a chain reaction', async ({ page }) => {
            const r = await page.evaluate(() => {
                startGame();
                spawnRemaining = 0;
                setChain([0, 0, 1, 1, 1, 0], 500);
                combo = 0;
                score = 0;
                resolveMatches(2);                 // burst the three 1s -> 0,0 ... 0
                const afterBurst = balls.length;
                let cleared = false;
                for (let i = 0; i < 120 && !cleared; i++) {
                    step(0.016);
                    cleared = balls.length === 0;
                }
                return { afterBurst, cleared, score, combo };
            });
            expect(r.afterBurst).toBe(3);
            expect(r.cleared).toBe(true);
            expect(r.combo).toBeGreaterThanOrEqual(2);
            expect(r.score).toBeGreaterThan(0);
        });

        test('a gap closing between different colours does not burst', async ({ page }) => {
            const n = await page.evaluate(() => {
                startGame();
                spawnRemaining = 0;
                setChain([0, 1], 400);
                balls[1].dist = 250;
                for (let i = 0; i < 200; i++) step(0.016);
                return balls.length;
            });
            expect(n).toBe(2);
        });
    });

    // -----------------------------------------------------------------------
    // Levels
    // -----------------------------------------------------------------------
    test.describe('levels', () => {
        test('the spawn supply drains as marbles roll out', async ({ page }) => {
            const { before, after } = await page.evaluate(() => {
                startGame();
                const before = spawnRemaining;
                for (let i = 0; i < 300; i++) step(0.016);
                return { before, after: spawnRemaining };
            });
            expect(after).toBeLessThan(before);
        });

        test('no marbles spawn once the supply is empty', async ({ page }) => {
            const n = await page.evaluate(() => {
                startGame();
                spawnRemaining = 0;
                balls.length = 0;
                setChain([0, 1], 400);
                for (let i = 0; i < 100; i++) step(0.016);
                return balls.length;
            });
            expect(n).toBe(2);
        });

        test('clearing the track advances to the next level', async ({ page }) => {
            const r = await page.evaluate(() => {
                startGame();
                spawnRemaining = 0;
                balls.length = 0;
                step(0.016);
                return { level, state, remaining: spawnRemaining };
            });
            expect(r.level).toBe(2);
            expect(r.state).toBe('running');
            expect(r.remaining).toBeGreaterThan(0);
        });

        test('clearing a level awards a bonus', async ({ page }) => {
            const score = await page.evaluate(() => {
                startGame();
                score = 0;
                spawnRemaining = 0;
                balls.length = 0;
                step(0.016);
                return score;
            });
            expect(score).toBeGreaterThan(0);
        });

        test('later levels use more colours, up to the size of the palette', async ({ page }) => {
            const r = await page.evaluate(() => {
                startGame();
                level = 1;
                const early = colorCount();
                level = 30;
                return { early, late: colorCount(), palette: COLORS.length };
            });
            expect(r.late).toBeGreaterThan(r.early);
            expect(r.late).toBeLessThanOrEqual(r.palette);
        });

        test('a level-up banner is shown and then fades', async ({ page }) => {
            const r = await page.evaluate(() => {
                startGame();
                spawnRemaining = 0;
                balls.length = 0;
                step(0.016);
                const shown = { text: banner, time: bannerTime };
                for (let i = 0; i < 200; i++) step(0.016);
                return { shown, after: bannerTime };
            });
            expect(r.shown.text).toContain('2');
            expect(r.shown.time).toBeGreaterThan(0);
            expect(r.after).toBe(0);
        });

        test('the level indicator updates in the HUD', async ({ page }) => {
            await page.evaluate(() => {
                startGame();
                spawnRemaining = 0;
                balls.length = 0;
                step(0.016);
            });
            await expect(page.locator('#level')).toHaveText('2');
        });
    });

    // -----------------------------------------------------------------------
    // Losing
    // -----------------------------------------------------------------------
    test.describe('game over', () => {
        test('a marble reaching the hole ends the game', async ({ page }) => {
            const s = await page.evaluate(() => {
                startGame();
                setChain([0, 1, 2], PATH_LENGTH - 1);
                step(0.05);
                return state;
            });
            expect(s).toBe('over');
        });

        test('the game continues while the chain is short of the hole', async ({ page }) => {
            const s = await page.evaluate(() => {
                startGame();
                setChain([0, 1, 2], PATH_LENGTH - 300);
                step(0.05);
                return state;
            });
            expect(s).toBe('running');
        });

        test('game over shows the overlay with Play Again', async ({ page }) => {
            await page.evaluate(() => { startGame(); endGame(); });
            await expect(page.locator('#overlay')).toHaveClass(/visible/);
            await expect(page.locator('#btn-start')).toHaveText('Play Again');
        });

        test('the best score is updated and persisted', async ({ page }) => {
            await page.evaluate(() => {
                startGame();
                score = 1234;
                updateHud();
                endGame();
            });
            await expect(page.locator('#best')).toHaveText('1234');
            const stored = await page.evaluate(() => window.localStorage.getItem('marble-chain-best'));
            expect(parseInt(stored, 10)).toBe(1234);
        });

        test('a worse run does not lower the best score', async ({ page }) => {
            await page.evaluate(() => window.localStorage.setItem('marble-chain-best', '9000'));
            await page.reload();
            await page.evaluate(() => {
                startGame();
                score = 12;
                updateHud();
                endGame();
            });
            await expect(page.locator('#best')).toHaveText('9000');
        });
    });

    // -----------------------------------------------------------------------
    // Pause and restart
    // -----------------------------------------------------------------------
    test.describe('pause and restart', () => {
        test('pausing freezes the chain', async ({ page }) => {
            const { before, after } = await page.evaluate(() => {
                startGame();
                setChain([0, 1, 2], 400);
                togglePause();
                const before = balls[0].dist;
                for (let i = 0; i < 10; i++) step(0.016);
                return { before, after: balls[0].dist };
            });
            expect(after).toBe(before);
        });

        test('resuming lets the chain roll again', async ({ page }) => {
            const moved = await page.evaluate(() => {
                startGame();
                setChain([0, 1, 2], 400);
                togglePause();
                togglePause();
                const before = balls[0].dist;
                for (let i = 0; i < 10; i++) step(0.016);
                return balls[0].dist > before;
            });
            expect(moved).toBe(true);
        });

        test('firing while paused does nothing', async ({ page }) => {
            const n = await page.evaluate(() => {
                startGame();
                togglePause();
                fire();
                return projectiles.length;
            });
            expect(n).toBe(0);
        });

        test('restarting resets score, level, chain and projectiles', async ({ page }) => {
            const r = await page.evaluate(() => {
                startGame();
                score = 999;
                level = 7;
                setChain([0, 1, 2], 400);
                fire();
                endGame();
                startGame();
                return { score, level, balls: balls.length, projectiles: projectiles.length, state };
            });
            expect(r).toEqual({ score: 0, level: 1, balls: 0, projectiles: 0, state: 'running' });
        });
    });
});
