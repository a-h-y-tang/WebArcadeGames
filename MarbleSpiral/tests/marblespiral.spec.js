const { test, expect } = require('@playwright/test');
const path = require('path');
const { pathToFileURL } = require('url');

const GAME_URL = pathToFileURL(path.resolve(__dirname, '../index.html')).href;

test.describe('Marble Spiral', () => {
    test.beforeEach(async ({ page }) => {
        await page.goto(GAME_URL);
    });

    // -----------------------------------------------------------------------
    // Initial / idle state
    // -----------------------------------------------------------------------
    test.describe('initial state', () => {
        test('page title is Marble Spiral', async ({ page }) => {
            await expect(page).toHaveTitle('Marble Spiral');
        });

        test('start overlay is visible', async ({ page }) => {
            await expect(page.locator('#overlay')).toHaveClass(/visible/);
        });

        test('overlay prompts the player to start', async ({ page }) => {
            await expect(page.locator('#overlay-sub')).toContainText(/space|start/i);
        });

        test('score, level and best start at their base values', async ({ page }) => {
            await expect(page.locator('#score')).toHaveText('0');
            await expect(page.locator('#level')).toHaveText('1');
            await expect(page.locator('#best')).toHaveText('0');
        });

        test('canvas is 600x480', async ({ page }) => {
            const canvas = page.locator('#canvas');
            await expect(canvas).toHaveAttribute('width', '600');
            await expect(canvas).toHaveAttribute('height', '480');
        });

        test('state is idle before starting', async ({ page }) => {
            expect(await page.evaluate(() => state)).toBe('idle');
        });

        test('no marbles on the track before starting', async ({ page }) => {
            expect(await page.evaluate(() => balls.length)).toBe(0);
        });

        test('best score loads from localStorage', async ({ page }) => {
            await page.evaluate(() => window.localStorage.setItem('marble-spiral-best', '4210'));
            await page.reload();
            await expect(page.locator('#best')).toHaveText('4210');
        });
    });

    // -----------------------------------------------------------------------
    // The track
    // -----------------------------------------------------------------------
    test.describe('track', () => {
        test('the track has a positive length', async ({ page }) => {
            expect(await page.evaluate(() => PATH_LEN)).toBeGreaterThan(500);
        });

        test('the track starts off the right edge of the canvas', async ({ page }) => {
            const p = await page.evaluate(() => pathPoint(0));
            expect(p.x).toBeGreaterThan(600);
        });

        test('the track ends at the pit near the middle of the canvas', async ({ page }) => {
            const d = await page.evaluate(() => {
                const p = pathPoint(PATH_LEN);
                return Math.hypot(p.x - CENTER.x, p.y - CENTER.y);
            });
            expect(d).toBeLessThan(120);
        });

        test('the whole track after the entrance stays inside the canvas', async ({ page }) => {
            const inside = await page.evaluate(() => {
                for (let d = 60; d <= PATH_LEN; d++) {
                    const p = pathPoint(d);
                    if (p.x < 0 || p.x > CANVAS_W || p.y < 0 || p.y > CANVAS_H) return false;
                }
                return true;
            });
            expect(inside).toBe(true);
        });

        test('consecutive track positions are about one pixel apart', async ({ page }) => {
            const max = await page.evaluate(() => {
                let worst = 0;
                for (let d = 0; d < PATH_LEN; d++) {
                    const a = pathPoint(d), b = pathPoint(d + 1);
                    worst = Math.max(worst, Math.hypot(b.x - a.x, b.y - a.y));
                }
                return worst;
            });
            expect(max).toBeLessThan(1.5);
        });

        test('positions past either end of the track are clamped', async ({ page }) => {
            const same = await page.evaluate(() => {
                const a = pathPoint(-500), b = pathPoint(0);
                const c = pathPoint(PATH_LEN + 500), d = pathPoint(PATH_LEN);
                return a.x === b.x && a.y === b.y && c.x === d.x && c.y === d.y;
            });
            expect(same).toBe(true);
        });

        test('the shooter sits in the clear middle of the spiral', async ({ page }) => {
            const clearance = await page.evaluate(() => {
                let nearest = Infinity;
                for (let d = 0; d <= PATH_LEN; d++) {
                    const p = pathPoint(d);
                    nearest = Math.min(nearest, Math.hypot(p.x - shooter.x, p.y - shooter.y));
                }
                return nearest;
            });
            expect(clearance).toBeGreaterThan(30);
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

        test('a new game starts on level 1 with a zero score', async ({ page }) => {
            const s = await page.evaluate(() => { startGame(); return { level, score }; });
            expect(s.level).toBe(1);
            expect(s.score).toBe(0);
        });

        test('the level is loaded with its full run of marbles', async ({ page }) => {
            const s = await page.evaluate(() => {
                startGame();
                return { queued: queue.length + balls.length, expected: levelBallCount(1) };
            });
            expect(s.queued).toBe(s.expected);
        });

        test('the shooter is loaded with a current and a next marble', async ({ page }) => {
            const s = await page.evaluate(() => {
                startGame();
                return { color: shooter.color, next: shooter.next, palette: levelColors(1) };
            });
            expect(s.palette).toContain(s.color);
            expect(s.palette).toContain(s.next);
        });

        test('level 1 uses three marble colours', async ({ page }) => {
            expect(await page.evaluate(() => levelColors(1).length)).toBe(3);
        });
    });

    // -----------------------------------------------------------------------
    // The marble train
    // -----------------------------------------------------------------------
    test.describe('the marble train', () => {
        test('marbles feed onto the track from the queue', async ({ page }) => {
            const s = await page.evaluate(() => {
                startGame();
                for (let i = 0; i < 120; i++) step(0.016);
                return { onTrack: balls.length, queued: queue.length };
            });
            expect(s.onTrack).toBeGreaterThan(1);
            expect(s.queued).toBeLessThan(30);
        });

        test('the train crawls towards the pit over time', async ({ page }) => {
            const s = await page.evaluate(() => {
                startGame();
                step(0.016);
                const before = balls[0].dist;
                for (let i = 0; i < 30; i++) step(0.016);
                return { before, after: balls[0].dist };
            });
            expect(s.after).toBeGreaterThan(s.before);
        });

        test('marbles never overlap on the track', async ({ page }) => {
            const worst = await page.evaluate(() => {
                startGame();
                let smallest = Infinity;
                for (let i = 0; i < 400; i++) {
                    step(0.016);
                    for (let b = 1; b < balls.length; b++) {
                        smallest = Math.min(smallest, balls[b - 1].dist - balls[b].dist);
                    }
                }
                return smallest;
            });
            expect(worst).toBeGreaterThanOrEqual(26 - 0.001);
        });

        test('a run the level starts with does not pop on its own', async ({ page }) => {
            const s = await page.evaluate(() => {
                startGame();
                queue.length = 0;
                setChain(['#ff4d5a', '#ffd23f', '#ffd23f', '#ffd23f', '#4aa3ff'], 900);
                for (let i = 0; i < 120; i++) step(0.016);
                return { count: balls.length, score };
            });
            expect(s.count).toBe(5);
            expect(s.score).toBe(0);
        });

        test('later levels push the train along faster', async ({ page }) => {
            const s = await page.evaluate(() => ({ l1: levelSpeed(1), l4: levelSpeed(4) }));
            expect(s.l4).toBeGreaterThan(s.l1);
        });

        test('later levels use more marbles and more colours', async ({ page }) => {
            const s = await page.evaluate(() => ({
                n1: levelBallCount(1), n5: levelBallCount(5),
                c1: levelColors(1).length, c5: levelColors(5).length,
            }));
            expect(s.n5).toBeGreaterThan(s.n1);
            expect(s.c5).toBeGreaterThan(s.c1);
        });
    });

    // -----------------------------------------------------------------------
    // Aiming and shooting
    // -----------------------------------------------------------------------
    test.describe('aiming and shooting', () => {
        test('aimAt points the shooter at the given spot', async ({ page }) => {
            const s = await page.evaluate(() => {
                startGame();
                aimAt(shooter.x + 100, shooter.y);
                const right = shooter.angle;
                aimAt(shooter.x, shooter.y - 100);
                return { right, up: shooter.angle };
            });
            expect(s.right).toBeCloseTo(0, 3);
            expect(s.up).toBeCloseTo(-Math.PI / 2, 3);
        });

        test('shooting launches a marble of the loaded colour', async ({ page }) => {
            const s = await page.evaluate(() => {
                startGame();
                const loaded = shooter.color;
                aimAt(shooter.x + 100, shooter.y);
                shoot();
                return { count: shots.length, color: shots[0].color, loaded };
            });
            expect(s.count).toBe(1);
            expect(s.color).toBe(s.loaded);
        });

        test('shooting reloads the shooter with the next marble', async ({ page }) => {
            const s = await page.evaluate(() => {
                startGame();
                const next = shooter.next;
                shoot();
                return { next, color: shooter.color, hasNext: !!shooter.next };
            });
            expect(s.color).toBe(s.next);
            expect(s.hasNext).toBe(true);
        });

        test('swapping exchanges the loaded and next marbles', async ({ page }) => {
            const s = await page.evaluate(() => {
                startGame();
                shooter.color = '#ff4d5a';
                shooter.next = '#4aa3ff';
                swapBall();
                return { color: shooter.color, next: shooter.next };
            });
            expect(s.color).toBe('#4aa3ff');
            expect(s.next).toBe('#ff4d5a');
        });

        test('a fired marble travels away from the shooter', async ({ page }) => {
            const s = await page.evaluate(() => {
                startGame();
                balls.length = 0;
                queue.length = 0;
                aimAt(shooter.x + 100, shooter.y);
                shoot();
                const before = shots[0].x;
                step(0.05);
                return { before, after: shots[0].x };
            });
            expect(s.after).toBeGreaterThan(s.before);
        });

        test('a marble that hits nothing leaves the board', async ({ page }) => {
            const left = await page.evaluate(() => {
                startGame();
                balls.length = 0;
                aimAt(shooter.x - 200, shooter.y - 200);
                shoot();
                for (let i = 0; i < 60; i++) step(0.016);
                return shots.length;
            });
            expect(left).toBe(0);
        });

        test('the shooter cannot fire while paused', async ({ page }) => {
            const count = await page.evaluate(() => {
                startGame();
                togglePause();
                shoot();
                return shots.length;
            });
            expect(count).toBe(0);
        });

        test('clicking the canvas fires a marble', async ({ page }) => {
            await page.evaluate(() => startGame());
            await page.locator('#canvas').click({ position: { x: 300, y: 60 } });
            expect(await page.evaluate(() => shots.length)).toBeGreaterThan(0);
        });

        test('the shooter only loads colours still in play', async ({ page }) => {
            const allSame = await page.evaluate(() => {
                startGame();
                queue.length = 0;
                setChain(['#3ddc84', '#3ddc84'], 400);
                for (let i = 0; i < 30; i++) {
                    if (pickColor() !== '#3ddc84') return false;
                }
                return true;
            });
            expect(allSame).toBe(true);
        });
    });

    // -----------------------------------------------------------------------
    // Inserting into the train
    // -----------------------------------------------------------------------
    test.describe('inserting', () => {
        test('a marble that reaches the train joins it', async ({ page }) => {
            const s = await page.evaluate(() => {
                startGame();
                queue.length = 0;
                setChain(['#ff4d5a', '#ffd23f', '#4aa3ff'], PATH_LEN - 200);
                const p = pathPoint(balls[1].dist);
                spawnShot(p.x, p.y, '#3ddc84', 0, 0);
                step(0.016);
                return { count: balls.length, shots: shots.length, colors: balls.map((b) => b.color) };
            });
            expect(s.count).toBe(4);
            expect(s.shots).toBe(0);
            expect(s.colors).toContain('#3ddc84');
        });

        test('a marble dropped behind a target lands behind it', async ({ page }) => {
            const colors = await page.evaluate(() => {
                startGame();
                queue.length = 0;
                setChain(['#ff4d5a', '#ffd23f', '#4aa3ff'], PATH_LEN - 200);
                const p = pathPoint(balls[1].dist - 8);
                spawnShot(p.x, p.y, '#3ddc84', 0, 0);
                step(0.016);
                return balls.map((b) => b.color);
            });
            expect(colors).toEqual(['#ff4d5a', '#ffd23f', '#3ddc84', '#4aa3ff']);
        });

        test('a marble dropped ahead of a target lands in front of it', async ({ page }) => {
            const colors = await page.evaluate(() => {
                startGame();
                queue.length = 0;
                setChain(['#ff4d5a', '#ffd23f', '#4aa3ff'], PATH_LEN - 200);
                const p = pathPoint(balls[1].dist + 8);
                spawnShot(p.x, p.y, '#3ddc84', 0, 0);
                step(0.016);
                return balls.map((b) => b.color);
            });
            expect(colors).toEqual(['#ff4d5a', '#3ddc84', '#ffd23f', '#4aa3ff']);
        });

        test('inserting pushes the tail back instead of the head forward', async ({ page }) => {
            const s = await page.evaluate(() => {
                startGame();
                queue.length = 0;
                setChain(['#ff4d5a', '#ffd23f', '#4aa3ff'], PATH_LEN - 200);
                const head = balls[0].dist;
                const tail = balls[2].dist;
                const p = pathPoint(balls[1].dist - 8);
                spawnShot(p.x, p.y, '#3ddc84', 0, 0);
                step(0);
                return { head, newHead: balls[0].dist, tail, newTail: balls[balls.length - 1].dist };
            });
            expect(s.newHead).toBeCloseTo(s.head, 5);
            expect(s.newTail).toBeLessThan(s.tail);
        });

        test('a fired marble aimed at the train joins it', async ({ page }) => {
            const s = await page.evaluate(() => {
                startGame();
                queue.length = 0;
                setChain(['#ff4d5a', '#ffd23f', '#4aa3ff'], PATH_LEN - 40);
                const target = pathPoint(balls[1].dist);
                shooter.color = '#3ddc84';
                aimAt(target.x, target.y);
                shoot();
                for (let i = 0; i < 30 && shots.length; i++) step(0.016);
                return { count: balls.length, colors: balls.map((b) => b.color) };
            });
            expect(s.count).toBe(4);
            expect(s.colors).toContain('#3ddc84');
        });
    });

    // -----------------------------------------------------------------------
    // Matching
    // -----------------------------------------------------------------------
    test.describe('matching', () => {
        test('completing a run of three clears them', async ({ page }) => {
            const s = await page.evaluate(() => {
                startGame();
                queue.length = 0;
                setChain(['#ff4d5a', '#ffd23f', '#ffd23f', '#4aa3ff'], PATH_LEN - 200);
                const p = pathPoint(balls[1].dist + 8);
                spawnShot(p.x, p.y, '#ffd23f', 0, 0);
                step(0.016);
                return balls.map((b) => b.color);
            });
            expect(s).toEqual(['#ff4d5a', '#4aa3ff']);
        });

        test('clearing a run scores points', async ({ page }) => {
            const s = await page.evaluate(() => {
                startGame();
                queue.length = 0;
                score = 0;
                setChain(['#ff4d5a', '#ffd23f', '#ffd23f', '#4aa3ff'], PATH_LEN - 200);
                const p = pathPoint(balls[1].dist + 8);
                spawnShot(p.x, p.y, '#ffd23f', 0, 0);
                step(0.016);
                return score;
            });
            expect(s).toBeGreaterThanOrEqual(30);
        });

        test('a pair is not enough to clear', async ({ page }) => {
            const s = await page.evaluate(() => {
                startGame();
                queue.length = 0;
                setChain(['#ff4d5a', '#ffd23f', '#4aa3ff'], PATH_LEN - 200);
                const p = pathPoint(balls[1].dist + 8);
                spawnShot(p.x, p.y, '#ffd23f', 0, 0);
                step(0.016);
                return balls.length;
            });
            expect(s).toBe(4);
        });

        test('a run of five clears all five', async ({ page }) => {
            const s = await page.evaluate(() => {
                startGame();
                queue.length = 0;
                score = 0;
                setChain(['#ff4d5a', '#ffd23f', '#ffd23f', '#ffd23f', '#ffd23f', '#4aa3ff'], PATH_LEN - 300);
                const p = pathPoint(balls[2].dist + 8);
                spawnShot(p.x, p.y, '#ffd23f', 0, 0);
                step(0.016);
                return { colors: balls.map((b) => b.color), score };
            });
            expect(s.colors).toEqual(['#ff4d5a', '#4aa3ff']);
            expect(s.score).toBeGreaterThanOrEqual(50);
        });

        test('a bigger group is worth more than a smaller one', async ({ page }) => {
            const s = await page.evaluate(() => {
                const clearRun = (n) => {
                    startGame();
                    queue.length = 0;
                    score = 0;
                    const colors = ['#ff4d5a'];
                    for (let i = 0; i < n - 1; i++) colors.push('#ffd23f');
                    colors.push('#4aa3ff');
                    setChain(colors, PATH_LEN - 300);
                    const p = pathPoint(balls[1].dist + 8);
                    spawnShot(p.x, p.y, '#ffd23f', 0, 0);
                    step(0.016);
                    return score;
                };
                return { three: clearRun(3), five: clearRun(5) };
            });
            expect(s.five).toBeGreaterThan(s.three);
        });

        test('the marbles-left readout drops when a run is cleared', async ({ page }) => {
            await page.evaluate(() => {
                startGame();
                queue.length = 0;
                setChain(['#ff4d5a', '#ffd23f', '#ffd23f', '#4aa3ff'], PATH_LEN - 200);
                updateHud();
            });
            await expect(page.locator('#left')).toHaveText('4');
            await page.evaluate(() => {
                const p = pathPoint(balls[1].dist + 8);
                spawnShot(p.x, p.y, '#ffd23f', 0, 0);
                step(0.016);
            });
            await expect(page.locator('#left')).toHaveText('2');
        });
    });

    // -----------------------------------------------------------------------
    // Gaps and chain reactions
    // -----------------------------------------------------------------------
    test.describe('gaps and chain reactions', () => {
        test('the tail closes the gap left by a cleared run', async ({ page }) => {
            const s = await page.evaluate(() => {
                startGame();
                queue.length = 0;
                setChain(['#ff4d5a', '#ffd23f', '#ffd23f', '#4aa3ff', '#c46bff'], PATH_LEN - 400);
                const p = pathPoint(balls[1].dist + 8);
                spawnShot(p.x, p.y, '#ffd23f', 0, 0);
                step(0.016);
                const gapBefore = balls[0].dist - balls[1].dist;
                for (let i = 0; i < 5; i++) step(0.016);
                return { gapBefore, gapAfter: balls[0].dist - balls[1].dist };
            });
            expect(s.gapBefore).toBeGreaterThan(26);
            expect(s.gapAfter).toBeLessThan(s.gapBefore);
        });

        test('a gap that closes on matching colours clears again', async ({ page }) => {
            const s = await page.evaluate(() => {
                startGame();
                queue.length = 0;
                score = 0;
                setChain(
                    ['#3ddc84', '#3ddc84', '#ffd23f', '#ffd23f', '#3ddc84', '#3ddc84'],
                    PATH_LEN - 500,
                );
                const p = pathPoint(balls[2].dist + 8);
                spawnShot(p.x, p.y, '#ffd23f', 0, 0);
                step(0.016);
                const afterFirst = balls.length;
                for (let i = 0; i < 90; i++) step(0.016);
                return { afterFirst, remaining: balls.length, score, combo };
            });
            expect(s.afterFirst).toBe(4);
            expect(s.remaining).toBe(0);
            expect(s.combo).toBeGreaterThanOrEqual(2);
            expect(s.score).toBeGreaterThanOrEqual(110);
        });

        test('a gap that closes on different colours leaves the train intact', async ({ page }) => {
            const s = await page.evaluate(() => {
                startGame();
                queue.length = 0;
                setChain(
                    ['#3ddc84', '#3ddc84', '#ffd23f', '#ffd23f', '#4aa3ff', '#c46bff'],
                    PATH_LEN - 500,
                );
                const p = pathPoint(balls[2].dist + 8);
                spawnShot(p.x, p.y, '#ffd23f', 0, 0);
                step(0.016);
                for (let i = 0; i < 90; i++) step(0.016);
                return balls.length;
            });
            expect(s).toBe(4);
        });
    });

    // -----------------------------------------------------------------------
    // Level flow
    // -----------------------------------------------------------------------
    test.describe('levels', () => {
        test('clearing every marble completes the level', async ({ page }) => {
            const s = await page.evaluate(() => {
                startGame();
                queue.length = 0;
                setChain(['#ff4d5a', '#ffd23f', '#ffd23f', '#ffd23f'], PATH_LEN - 300);
                balls.splice(0, 1);
                const p = pathPoint(balls[0].dist + 8);
                spawnShot(p.x, p.y, '#ffd23f', 0, 0);
                step(0.016);
                return { state, balls: balls.length };
            });
            expect(s.balls).toBe(0);
            expect(s.state).toBe('levelup');
        });

        test('completing a level shows the level cleared overlay', async ({ page }) => {
            await page.evaluate(() => { startGame(); queue.length = 0; balls.length = 0; step(0.016); });
            await expect(page.locator('#overlay')).toHaveClass(/visible/);
            await expect(page.locator('#overlay-title')).toContainText(/clear/i);
            await expect(page.locator('#btn-start')).toHaveText(/next level/i);
        });

        test('continuing starts the next level with a fresh train', async ({ page }) => {
            const s = await page.evaluate(() => {
                startGame();
                queue.length = 0;
                balls.length = 0;
                step(0.016);
                nextLevel();
                return { level, state, queued: queue.length + balls.length, expected: levelBallCount(2) };
            });
            expect(s.level).toBe(2);
            expect(s.state).toBe('running');
            expect(s.queued).toBe(s.expected);
        });

        test('Space continues to the next level', async ({ page }) => {
            await page.evaluate(() => { startGame(); queue.length = 0; balls.length = 0; step(0.016); });
            await page.keyboard.press('Space');
            const s = await page.evaluate(() => ({ level, state }));
            expect(s.level).toBe(2);
            expect(s.state).toBe('running');
        });

        test('completing a level keeps the score and awards a bonus', async ({ page }) => {
            const s = await page.evaluate(() => {
                startGame();
                score = 500;
                queue.length = 0;
                balls.length = 0;
                step(0.016);
                return score;
            });
            expect(s).toBeGreaterThan(500);
        });
    });

    // -----------------------------------------------------------------------
    // Losing
    // -----------------------------------------------------------------------
    test.describe('game over', () => {
        test('a marble reaching the pit ends the game', async ({ page }) => {
            const s = await page.evaluate(() => {
                startGame();
                queue.length = 0;
                setChain(['#ff4d5a', '#ffd23f'], PATH_LEN - 1);
                for (let i = 0; i < 30; i++) step(0.016);
                return state;
            });
            expect(s).toBe('over');
        });

        test('game over shows the overlay with Play Again', async ({ page }) => {
            await page.evaluate(() => { startGame(); endGame(); });
            await expect(page.locator('#overlay')).toHaveClass(/visible/);
            await expect(page.locator('#btn-start')).toHaveText(/play again/i);
        });

        test('the game stops updating once it is over', async ({ page }) => {
            const s = await page.evaluate(() => {
                startGame();
                queue.length = 0;
                setChain(['#ff4d5a', '#ffd23f'], 400);
                endGame();
                const before = balls[0].dist;
                for (let i = 0; i < 20; i++) step(0.016);
                return { before, after: balls[0].dist };
            });
            expect(s.after).toBe(s.before);
        });

        test('best score updates on game over when beaten', async ({ page }) => {
            await page.evaluate(() => { startGame(); score = 777; updateHud(); endGame(); });
            await expect(page.locator('#best')).toHaveText('777');
        });

        test('best score persists to localStorage', async ({ page }) => {
            await page.evaluate(() => { startGame(); score = 640; updateHud(); endGame(); });
            const stored = await page.evaluate(() => window.localStorage.getItem('marble-spiral-best'));
            expect(parseInt(stored, 10)).toBe(640);
        });

        test('best score is not lowered by a worse run', async ({ page }) => {
            await page.evaluate(() => window.localStorage.setItem('marble-spiral-best', '9000'));
            await page.reload();
            await page.evaluate(() => { startGame(); score = 10; updateHud(); endGame(); });
            await expect(page.locator('#best')).toHaveText('9000');
        });
    });

    // -----------------------------------------------------------------------
    // Pause and restart
    // -----------------------------------------------------------------------
    test.describe('pause and restart', () => {
        test('pausing freezes the train', async ({ page }) => {
            const s = await page.evaluate(() => {
                startGame();
                step(0.016);
                togglePause();
                const before = balls[0].dist;
                for (let i = 0; i < 20; i++) step(0.016);
                return { before, after: balls[0].dist, state };
            });
            expect(s.after).toBe(s.before);
            expect(s.state).toBe('paused');
        });

        test('resuming lets the train move again', async ({ page }) => {
            const moved = await page.evaluate(() => {
                startGame();
                step(0.016);
                togglePause();
                togglePause();
                const before = balls[0].dist;
                for (let i = 0; i < 20; i++) step(0.016);
                return balls[0].dist > before;
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

        test('restarting after game over resets score, level and the track', async ({ page }) => {
            const s = await page.evaluate(() => {
                startGame();
                score = 1234;
                level = 7;
                endGame();
                startGame();
                return { score, level, state, onTrack: balls.length, shots: shots.length };
            });
            expect(s.score).toBe(0);
            expect(s.level).toBe(1);
            expect(s.state).toBe('running');
            expect(s.onTrack).toBe(0);
            expect(s.shots).toBe(0);
        });

        test('the HUD reflects score, level and marbles left', async ({ page }) => {
            await page.evaluate(() => {
                startGame();
                score = 250;
                level = 3;
                queue.length = 0;
                setChain(['#ff4d5a', '#ffd23f'], 300);
                updateHud();
            });
            await expect(page.locator('#score')).toHaveText('250');
            await expect(page.locator('#level')).toHaveText('3');
            await expect(page.locator('#left')).toHaveText('2');
        });
    });
});
