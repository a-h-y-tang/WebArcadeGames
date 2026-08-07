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

        test('canvas is 600x400', async ({ page }) => {
            const canvas = page.locator('#canvas');
            await expect(canvas).toHaveAttribute('width', '600');
            await expect(canvas).toHaveAttribute('height', '400');
        });

        test('start overlay is visible and prompts the player', async ({ page }) => {
            await expect(page.locator('#overlay')).toHaveClass(/visible/);
            await expect(page.locator('#overlay-sub')).toContainText(/space|start/i);
        });

        test('score, level and best start at their defaults', async ({ page }) => {
            await expect(page.locator('#score')).toHaveText('0');
            await expect(page.locator('#level')).toHaveText('1');
            await expect(page.locator('#best')).toHaveText('0');
        });

        test('state is idle before starting', async ({ page }) => {
            expect(await page.evaluate(() => state)).toBe('idle');
        });

        test('no marbles or shots before starting', async ({ page }) => {
            const counts = await page.evaluate(() => ({ b: balls.length, p: projectiles.length }));
            expect(counts).toEqual({ b: 0, p: 0 });
        });

        test('best score loads from localStorage', async ({ page }) => {
            await page.evaluate(() => window.localStorage.setItem('marblechain-best', '4210'));
            await page.reload();
            await expect(page.locator('#best')).toHaveText('4210');
        });
    });

    // -----------------------------------------------------------------------
    // The path the chain crawls along
    // -----------------------------------------------------------------------
    test.describe('path', () => {
        test('the path has a positive length', async ({ page }) => {
            expect(await page.evaluate(() => pathLength())).toBeGreaterThan(0);
        });

        test('pointAt(0) is the first waypoint', async ({ page }) => {
            const same = await page.evaluate(() => {
                const p = pointAt(0);
                return Math.abs(p.x - path[0].x) < 0.001 && Math.abs(p.y - path[0].y) < 0.001;
            });
            expect(same).toBe(true);
        });

        test('pointAt(pathLength()) is the last waypoint (the pit)', async ({ page }) => {
            const same = await page.evaluate(() => {
                const last = path[path.length - 1];
                const p = pointAt(pathLength());
                return Math.abs(p.x - last.x) < 0.001 && Math.abs(p.y - last.y) < 0.001;
            });
            expect(same).toBe(true);
        });

        test('pointAt clamps distances outside the path', async ({ page }) => {
            const r = await page.evaluate(() => {
                const before = pointAt(-500);
                const after = pointAt(pathLength() + 500);
                return {
                    startOk: before.x === path[0].x && before.y === path[0].y,
                    endOk: after.x === path[path.length - 1].x && after.y === path[path.length - 1].y,
                };
            });
            expect(r).toEqual({ startOk: true, endOk: true });
        });

        test('walking the path moves steadily forward', async ({ page }) => {
            const ok = await page.evaluate(() => {
                const L = pathLength();
                let prev = pointAt(0);
                for (let d = 10; d <= L; d += 10) {
                    const p = pointAt(d);
                    const step = Math.hypot(p.x - prev.x, p.y - prev.y);
                    if (step > 11) return false; // no teleporting between samples
                    prev = p;
                }
                return true;
            });
            expect(ok).toBe(true);
        });

        test('the whole path stays inside the canvas', async ({ page }) => {
            const ok = await page.evaluate(() =>
                path.every((p) => p.x >= 0 && p.x <= CANVAS_W && p.y >= 0 && p.y <= CANVAS_H));
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

        test('the Start button starts the game', async ({ page }) => {
            await page.locator('#btn-start').click();
            expect(await page.evaluate(() => state)).toBe('running');
        });

        test('a new game begins on level 1 with no score', async ({ page }) => {
            const s = await page.evaluate(() => { startGame(); return { level, score, state }; });
            expect(s).toEqual({ level: 1, score: 0, state: 'running' });
        });

        test('the shooter is loaded with a current and next colour', async ({ page }) => {
            const ok = await page.evaluate(() => {
                startGame();
                return LEVEL_COLORS.includes(currentColor) && LEVEL_COLORS.includes(nextColor);
            });
            expect(ok).toBe(true);
        });

        test('marbles feed onto the path once the game is running', async ({ page }) => {
            const n = await page.evaluate(() => {
                startGame();
                for (let i = 0; i < 120; i++) step(0.016);
                return balls.length;
            });
            expect(n).toBeGreaterThan(1);
        });
    });

    // -----------------------------------------------------------------------
    // The marble chain
    // -----------------------------------------------------------------------
    test.describe('chain', () => {
        test('the chain crawls toward the pit over time', async ({ page }) => {
            const { before, after } = await page.evaluate(() => {
                startGame();
                setChain(['red', 'blue', 'green'], 200);
                const before = balls[0].dist;
                for (let i = 0; i < 30; i++) step(0.016);
                return { before, after: balls[0].dist };
            });
            expect(after).toBeGreaterThan(before);
        });

        test('setChain lays marbles out one diameter apart, front first', async ({ page }) => {
            const dists = await page.evaluate(() => {
                startGame();
                setChain(['red', 'blue', 'green'], 300);
                return balls.map((b) => b.dist);
            });
            expect(dists).toEqual([300, 300 - 26, 300 - 52]);
        });

        test('marbles never overlap while the chain moves', async ({ page }) => {
            const ok = await page.evaluate(() => {
                startGame();
                for (let i = 0; i < 600; i++) {
                    step(0.016);
                    for (let j = 1; j < balls.length; j++) {
                        if (balls[j - 1].dist - balls[j].dist < BALL_D - 0.01) return false;
                    }
                }
                return true;
            });
            expect(ok).toBe(true);
        });

        test('a gap left by a pop closes up as the rear catches the front', async ({ page }) => {
            const { before, after } = await page.evaluate(() => {
                startGame();
                setChain(['red', 'blue'], 400);
                balls[1].dist = 200; // a big artificial gap
                const before = balls[0].dist - balls[1].dist;
                for (let i = 0; i < 60; i++) step(0.016);
                return { before, after: balls[0].dist - balls[1].dist };
            });
            expect(after).toBeLessThan(before);
        });

        test('a level feeds a fixed number of marbles then stops', async ({ page }) => {
            const r = await page.evaluate(() => {
                startGame();
                const total = ballsForLevel(level);
                let spawned = 0;
                const seen = new Set();
                for (let i = 0; i < 4000 && toSpawn > 0; i++) {
                    step(0.016);
                    balls.forEach((b) => { if (!seen.has(b)) { seen.add(b); spawned++; } });
                    // keep the pit from ending the run while we count
                    if (balls.length && balls[0].dist > pathLength() - 40) {
                        balls.forEach((b) => { b.dist -= 200; });
                    }
                }
                return { spawned, total, toSpawn };
            });
            expect(r.toSpawn).toBe(0);
            expect(r.spawned).toBe(r.total);
        });

        test('a fed chain mixes several colours from the level palette', async ({ page }) => {
            const r = await page.evaluate(() => {
                startGame();
                spawnDelay = 0;
                for (let i = 0; i < 1500; i++) step(0.016);
                const palette = colorsForLevel(level);
                return {
                    distinct: new Set(balls.map((b) => b.color)).size,
                    allInPalette: balls.every((b) => palette.includes(b.color)),
                    count: balls.length,
                };
            });
            expect(r.count).toBeGreaterThan(10);
            expect(r.allInPalette).toBe(true);
            expect(r.distinct).toBeGreaterThan(1);
        });

        test('the cannon only loads colours that are still on the track', async ({ page }) => {
            const ok = await page.evaluate(() => {
                startGame();
                toSpawn = 0;
                setChain(['red', 'red', 'red'], 300);
                for (let i = 0; i < 50; i++) {
                    if (pickColor() !== 'red') return false;
                }
                return true;
            });
            expect(ok).toBe(true);
        });

        test('the chain moves faster on later levels', async ({ page }) => {
            const { slow, fast } = await page.evaluate(() => {
                startGame();
                const slow = chainSpeed();
                level = 5;
                return { slow, fast: chainSpeed() };
            });
            expect(fast).toBeGreaterThan(slow);
        });

        test('the chain reaching the pit ends the game', async ({ page }) => {
            const s = await page.evaluate(() => {
                startGame();
                setChain(['red', 'blue'], pathLength() - 5);
                for (let i = 0; i < 60; i++) step(0.016);
                return state;
            });
            expect(s).toBe('over');
        });
    });

    // -----------------------------------------------------------------------
    // Shooting
    // -----------------------------------------------------------------------
    test.describe('shooting', () => {
        test('shooting launches a marble in the current colour', async ({ page }) => {
            const r = await page.evaluate(() => {
                startGame();
                currentColor = 'blue';
                const p = shoot(-Math.PI / 2);
                return { count: projectiles.length, color: p.color };
            });
            expect(r.count).toBe(1);
            expect(r.color).toBe('blue');
        });

        test('shooting reloads: next becomes current', async ({ page }) => {
            const r = await page.evaluate(() => {
                startGame();
                currentColor = 'red';
                nextColor = 'green';
                shoot(-Math.PI / 2);
                return { current: currentColor, nextIsValid: LEVEL_COLORS.includes(nextColor) };
            });
            expect(r.current).toBe('green');
            expect(r.nextIsValid).toBe(true);
        });

        test('a shot marble flies away from the shooter', async ({ page }) => {
            const r = await page.evaluate(() => {
                startGame();
                const p = shoot(-Math.PI / 2);
                const y0 = p.y;
                for (let i = 0; i < 10; i++) step(0.016);
                return { moved: y0 - p.y, x0: shooter.x, px: p.x };
            });
            expect(r.moved).toBeGreaterThan(0);
            expect(Math.abs(r.px - r.x0)).toBeLessThan(1);
        });

        test('a shot that leaves the canvas is discarded', async ({ page }) => {
            const n = await page.evaluate(() => {
                startGame();
                balls.length = 0;
                toSpawn = 0;
                shoot(-Math.PI / 2);
                for (let i = 0; i < 120; i++) step(0.016);
                return projectiles.length;
            });
            expect(n).toBe(0);
        });

        test('a cooldown stops the player from firing every frame', async ({ page }) => {
            const n = await page.evaluate(() => {
                startGame();
                shoot(-Math.PI / 2);
                shoot(-Math.PI / 2);
                shoot(-Math.PI / 2);
                return projectiles.length;
            });
            expect(n).toBe(1);
        });

        test('the cooldown expires so the player can fire again', async ({ page }) => {
            const n = await page.evaluate(() => {
                startGame();
                shoot(-Math.PI / 2);
                for (let i = 0; i < 40; i++) step(0.016);
                shoot(-Math.PI / 2);
                return projectiles.length;
            });
            expect(n).toBe(2);
        });

        test('swapping exchanges the current and next colours', async ({ page }) => {
            const r = await page.evaluate(() => {
                startGame();
                currentColor = 'red';
                nextColor = 'blue';
                swapColors();
                return { current: currentColor, next: nextColor };
            });
            expect(r).toEqual({ current: 'blue', next: 'red' });
        });

        test('aiming points the shooter at the cursor', async ({ page }) => {
            const angle = await page.evaluate(() => {
                startGame();
                aimAt(shooter.x, shooter.y - 100);
                return shooter.angle;
            });
            expect(angle).toBeCloseTo(-Math.PI / 2, 3);
        });

        test('the shooter cannot aim downward into its own base', async ({ page }) => {
            const angle = await page.evaluate(() => {
                startGame();
                aimAt(shooter.x, shooter.y + 100);
                return shooter.angle;
            });
            expect(angle).toBeLessThan(0);
        });
    });

    // -----------------------------------------------------------------------
    // Inserting into the chain
    // -----------------------------------------------------------------------
    test.describe('insertion', () => {
        test('a shot that hits the chain joins it', async ({ page }) => {
            const r = await page.evaluate(() => {
                startGame();
                toSpawn = 0;
                setChain(['red', 'blue', 'green', 'yellow'], 400);
                const hit = pointAt(balls[2].dist);
                spawnProjectile({ x: hit.x, y: hit.y - 40, vx: 0, vy: 0, color: 'purple' });
                projectiles[0].vy = 400;
                for (let i = 0; i < 20; i++) step(0.016);
                return { count: balls.length, shots: projectiles.length, colors: balls.map((b) => b.color) };
            });
            expect(r.count).toBe(5);
            expect(r.shots).toBe(0);
            expect(r.colors).toContain('purple');
        });

        test('an inserted marble lands next to the marble it struck', async ({ page }) => {
            const idx = await page.evaluate(() => {
                startGame();
                toSpawn = 0;
                setChain(['red', 'blue', 'green', 'yellow', 'cyan'], 400);
                const hit = pointAt(balls[2].dist);
                spawnProjectile({ x: hit.x, y: hit.y - 40, vx: 0, vy: 500, color: 'purple' });
                for (let i = 0; i < 20; i++) step(0.016);
                return balls.findIndex((b) => b.color === 'purple');
            });
            expect(idx).toBeGreaterThanOrEqual(1);
            expect(idx).toBeLessThanOrEqual(3);
        });

        test('insertion keeps the chain spaced and ordered', async ({ page }) => {
            const ok = await page.evaluate(() => {
                startGame();
                toSpawn = 0;
                setChain(['red', 'blue', 'green', 'yellow'], 400);
                const hit = pointAt(balls[2].dist);
                spawnProjectile({ x: hit.x, y: hit.y - 40, vx: 0, vy: 500, color: 'purple' });
                for (let i = 0; i < 20; i++) step(0.016);
                for (let j = 1; j < balls.length; j++) {
                    if (balls[j - 1].dist - balls[j].dist < BALL_D - 0.01) return false;
                }
                return true;
            });
            expect(ok).toBe(true);
        });

        test('insertion shoves the front of the chain toward the pit', async ({ page }) => {
            const { before, after } = await page.evaluate(() => {
                startGame();
                toSpawn = 0;
                setChain(['red', 'blue', 'green', 'yellow'], 400);
                const before = balls[0].dist;
                const hit = pointAt(balls[2].dist);
                spawnProjectile({ x: hit.x, y: hit.y - 40, vx: 0, vy: 500, color: 'purple' });
                step(0.016);
                step(0.016);
                return { before, after: balls[0].dist };
            });
            expect(after).toBeGreaterThanOrEqual(before + 26 - 1);
        });

        test('a shot that misses the chain never joins it', async ({ page }) => {
            const n = await page.evaluate(() => {
                startGame();
                toSpawn = 0;
                setChain(['red', 'blue', 'green'], 200);
                shoot(-Math.PI / 2 - 1.2); // off to the side, away from the chain
                for (let i = 0; i < 120; i++) step(0.016);
                return balls.length;
            });
            expect(n).toBe(3);
        });
    });

    // -----------------------------------------------------------------------
    // Matching
    // -----------------------------------------------------------------------
    test.describe('matching', () => {
        test('completing a run of three pops them', async ({ page }) => {
            const r = await page.evaluate(() => {
                startGame();
                toSpawn = 0;
                setChain(['red', 'red', 'blue', 'green'], 400);
                // slot a red in between the two reds and the rest
                const hit = pointAt(balls[1].dist);
                spawnProjectile({ x: hit.x, y: hit.y - 40, vx: 0, vy: 500, color: 'red' });
                for (let i = 0; i < 20; i++) step(0.016);
                return { colors: balls.map((b) => b.color), score };
            });
            expect(r.colors).toEqual(['blue', 'green']);
            expect(r.score).toBeGreaterThan(0);
        });

        test('a pair alone is not enough to pop', async ({ page }) => {
            const colors = await page.evaluate(() => {
                startGame();
                toSpawn = 0;
                setChain(['red', 'blue', 'green', 'yellow'], 400);
                const hit = pointAt(balls[0].dist);
                spawnProjectile({ x: hit.x, y: hit.y - 40, vx: 0, vy: 500, color: 'red' });
                for (let i = 0; i < 20; i++) step(0.016);
                return balls.map((b) => b.color);
            });
            expect(colors.filter((c) => c === 'red').length).toBe(2);
            expect(colors.length).toBe(5);
        });

        test('longer runs score more than the minimum three', async ({ page }) => {
            const { three, five } = await page.evaluate(() => {
                const run = (chain) => {
                    startGame();
                    toSpawn = 0;
                    setChain(chain, 400);
                    const hit = pointAt(balls[1].dist);
                    spawnProjectile({ x: hit.x, y: hit.y - 40, vx: 0, vy: 500, color: 'red' });
                    for (let i = 0; i < 20; i++) step(0.016);
                    return score;
                };
                return { three: run(['red', 'red', 'blue']), five: run(['red', 'red', 'red', 'red', 'blue']) };
            });
            expect(five).toBeGreaterThan(three);
        });

        test('a pop can set off a chain reaction with a combo bonus', async ({ page }) => {
            const r = await page.evaluate(() => {
                startGame();
                toSpawn = 0;
                // blue-blue [red red red] blue -> popping the reds joins the blues
                setChain(['blue', 'blue', 'red', 'red', 'blue', 'blue'], 500);
                const hit = pointAt(balls[3].dist);
                spawnProjectile({ x: hit.x, y: hit.y - 40, vx: 0, vy: 500, color: 'red' });
                for (let i = 0; i < 20; i++) step(0.016);
                return { remaining: balls.length, combo: bestCombo, score };
            });
            expect(r.remaining).toBe(0);
            expect(r.combo).toBeGreaterThanOrEqual(2);
            expect(r.score).toBeGreaterThan(0);
        });

        test('popping marbles updates the score readout', async ({ page }) => {
            await page.evaluate(() => {
                startGame();
                toSpawn = 0;
                setChain(['red', 'red', 'blue'], 400);
                const hit = pointAt(balls[1].dist);
                spawnProjectile({ x: hit.x, y: hit.y - 40, vx: 0, vy: 500, color: 'red' });
                for (let i = 0; i < 20; i++) step(0.016);
            });
            await expect(page.locator('#score')).not.toHaveText('0');
        });
    });

    // -----------------------------------------------------------------------
    // Levels
    // -----------------------------------------------------------------------
    test.describe('levels', () => {
        test('clearing every marble advances the level', async ({ page }) => {
            const r = await page.evaluate(() => {
                startGame();
                toSpawn = 0;
                setChain(['red', 'red', 'blue'], 400);
                balls.splice(2, 1);
                const hit = pointAt(balls[1].dist);
                spawnProjectile({ x: hit.x, y: hit.y - 40, vx: 0, vy: 500, color: 'red' });
                for (let i = 0; i < 30; i++) step(0.016);
                return { level, state };
            });
            expect(r.level).toBe(2);
            expect(r.state).toBe('running');
        });

        test('a new level restocks the marbles to feed', async ({ page }) => {
            const r = await page.evaluate(() => {
                startGame();
                toSpawn = 0;
                balls.length = 0;
                step(0.016);
                return { level, toSpawn };
            });
            expect(r.level).toBe(2);
            expect(r.toSpawn).toBe(await page.evaluate(() => ballsForLevel(2)));
        });

        test('the level readout follows the level', async ({ page }) => {
            await page.evaluate(() => { startGame(); level = 3; updateHud(); });
            await expect(page.locator('#level')).toHaveText('3');
        });

        test('later levels use more colours, up to the full set', async ({ page }) => {
            const r = await page.evaluate(() => ({
                one: colorsForLevel(1).length,
                nine: colorsForLevel(9).length,
                all: LEVEL_COLORS.length,
            }));
            expect(r.nine).toBeGreaterThan(r.one);
            expect(r.nine).toBeLessThanOrEqual(r.all);
        });
    });

    // -----------------------------------------------------------------------
    // Scoring, pause, restart
    // -----------------------------------------------------------------------
    test.describe('scoring and flow', () => {
        test('the best score is kept when the game ends', async ({ page }) => {
            await page.evaluate(() => { startGame(); score = 777; updateHud(); endGame(); });
            await expect(page.locator('#best')).toHaveText('777');
            const stored = await page.evaluate(() => window.localStorage.getItem('marblechain-best'));
            expect(parseInt(stored, 10)).toBe(777);
        });

        test('a worse run does not lower the best score', async ({ page }) => {
            await page.evaluate(() => window.localStorage.setItem('marblechain-best', '5000'));
            await page.reload();
            await page.evaluate(() => { startGame(); score = 12; updateHud(); endGame(); });
            await expect(page.locator('#best')).toHaveText('5000');
        });

        test('game over shows the overlay with Play Again', async ({ page }) => {
            await page.evaluate(() => { startGame(); endGame(); });
            await expect(page.locator('#overlay')).toHaveClass(/visible/);
            await expect(page.locator('#btn-start')).toHaveText('Play Again');
        });

        test('pausing freezes the chain and the shots', async ({ page }) => {
            const r = await page.evaluate(() => {
                startGame();
                setChain(['red', 'blue'], 200);
                shoot(-Math.PI / 2);
                togglePause();
                const b = balls[0].dist, p = projectiles[0].y;
                for (let i = 0; i < 20; i++) step(0.016);
                return { movedBall: balls[0].dist - b, movedShot: projectiles[0].y - p, state };
            });
            expect(r.movedBall).toBe(0);
            expect(r.movedShot).toBe(0);
            expect(r.state).toBe('paused');
        });

        test('resuming lets the chain crawl again', async ({ page }) => {
            const moved = await page.evaluate(() => {
                startGame();
                setChain(['red', 'blue'], 200);
                togglePause();
                togglePause();
                const b = balls[0].dist;
                for (let i = 0; i < 20; i++) step(0.016);
                return balls[0].dist > b;
            });
            expect(moved).toBe(true);
        });

        test('restarting resets score, level, chain and shots', async ({ page }) => {
            const r = await page.evaluate(() => {
                startGame();
                score = 4242;
                level = 7;
                setChain(['red', 'blue'], 300);
                shoot(-Math.PI / 2);
                endGame();
                startGame();
                return { score, level, balls: balls.length, projectiles: projectiles.length, state };
            });
            expect(r).toEqual({ score: 0, level: 1, balls: 0, projectiles: 0, state: 'running' });
        });

        test('shooting does nothing once the game is over', async ({ page }) => {
            const n = await page.evaluate(() => {
                startGame();
                endGame();
                shoot(-Math.PI / 2);
                return projectiles.length;
            });
            expect(n).toBe(0);
        });
    });
});
