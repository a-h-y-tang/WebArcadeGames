const { test, expect } = require('@playwright/test');
const path = require('path');
const { pathToFileURL } = require('url');

const GAME_URL = pathToFileURL(path.resolve(__dirname, '../index.html')).href;

test.describe('Marble Popper', () => {
    test.beforeEach(async ({ page }) => {
        await page.goto(GAME_URL);
    });

    // -----------------------------------------------------------------------
    // Initial / idle state
    // -----------------------------------------------------------------------
    test.describe('initial state', () => {
        test('page title is Marble Popper', async ({ page }) => {
            await expect(page).toHaveTitle('Marble Popper');
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

        test('canvas is 720x520', async ({ page }) => {
            const canvas = page.locator('#canvas');
            await expect(canvas).toHaveAttribute('width', '720');
            await expect(canvas).toHaveAttribute('height', '520');
        });

        test('state is idle before starting', async ({ page }) => {
            expect(await page.evaluate(() => state)).toBe('idle');
        });

        test('no marbles or shots before starting', async ({ page }) => {
            const counts = await page.evaluate(() => ({ balls: balls.length, shots: shots.length }));
            expect(counts).toEqual({ balls: 0, shots: 0 });
        });

        test('best score loads from localStorage', async ({ page }) => {
            await page.evaluate(() => window.localStorage.setItem('marble-popper-best', '4210'));
            await page.reload();
            await expect(page.locator('#best')).toHaveText('4210');
        });
    });

    // -----------------------------------------------------------------------
    // The spiral path
    // -----------------------------------------------------------------------
    test.describe('path', () => {
        test('path has a positive total length', async ({ page }) => {
            expect(await page.evaluate(() => PATH_LEN)).toBeGreaterThan(1000);
        });

        test('path is arc-length parameterised', async ({ page }) => {
            const gaps = await page.evaluate(() => {
                const out = [];
                for (let d = 0; d + 20 <= PATH_LEN; d += 137) {
                    const a = pathPos(d), b = pathPos(d + 20);
                    out.push(Math.hypot(b.x - a.x, b.y - a.y));
                }
                return out;
            });
            for (const g of gaps) expect(g).toBeGreaterThan(19);
            for (const g of gaps) expect(g).toBeLessThan(20.5);
        });

        test('path positions stay inside the canvas', async ({ page }) => {
            const ok = await page.evaluate(() => {
                for (let d = 0; d <= PATH_LEN; d += 5) {
                    const p = pathPos(d);
                    if (p.x < 0 || p.x > CANVAS_W || p.y < 0 || p.y > CANVAS_H) return false;
                }
                return true;
            });
            expect(ok).toBe(true);
        });

        test('pathPos clamps outside the path', async ({ page }) => {
            const same = await page.evaluate(() => {
                const a = pathPos(-500), b = pathPos(0);
                const c = pathPos(PATH_LEN + 500), e = pathPos(PATH_LEN);
                return { startsMatch: a.x === b.x && a.y === b.y, endsMatch: c.x === e.x && c.y === e.y };
            });
            expect(same).toEqual({ startsMatch: true, endsMatch: true });
        });

        test('the path ends at the pit', async ({ page }) => {
            const dist = await page.evaluate(() => {
                const p = pathPos(PATH_LEN);
                return Math.hypot(p.x - PIT.x, p.y - PIT.y);
            });
            expect(dist).toBeLessThan(1);
        });
    });

    // -----------------------------------------------------------------------
    // Starting a run
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

        test('a new run begins on level 1 with a full queue and no score', async ({ page }) => {
            const s = await page.evaluate(() => {
                startGame();
                return { level, score, queued: spawnQueue.length, balls: balls.length };
            });
            expect(s).toEqual({ level: 1, score: 0, queued: 24, balls: 0 });
        });

        test('the launcher is loaded with two in-palette colours', async ({ page }) => {
            const s = await page.evaluate(() => {
                startGame();
                return { current: launcher.current, next: launcher.next, colors: colorCount(1) };
            });
            expect(s.current).toBeGreaterThanOrEqual(0);
            expect(s.current).toBeLessThan(s.colors);
            expect(s.next).toBeGreaterThanOrEqual(0);
            expect(s.next).toBeLessThan(s.colors);
        });

        test('difficulty scales with level', async ({ page }) => {
            const s = await page.evaluate(() => ({
                colors: [colorCount(1), colorCount(3), colorCount(20)],
                lengths: [chainLength(1), chainLength(2)],
                speeds: [chainSpeed(1), chainSpeed(2)],
            }));
            expect(s.colors).toEqual([3, 4, 6]);
            expect(s.lengths).toEqual([24, 30]);
            expect(s.speeds[1]).toBeGreaterThan(s.speeds[0]);
        });
    });

    // -----------------------------------------------------------------------
    // Aiming
    // -----------------------------------------------------------------------
    test.describe('aiming', () => {
        test('aimAt points the launcher at a canvas position', async ({ page }) => {
            const aim = await page.evaluate(() => {
                startGame();
                aimAt(LAUNCHER.x + 100, LAUNCHER.y);
                return launcher.angle;
            });
            expect(aim).toBeCloseTo(0, 5);
        });

        test('aimAt below the launcher gives a positive angle', async ({ page }) => {
            const aim = await page.evaluate(() => {
                startGame();
                aimAt(LAUNCHER.x, LAUNCHER.y + 100);
                return launcher.angle;
            });
            expect(aim).toBeCloseTo(Math.PI / 2, 5);
        });

        test('ArrowRight rotates the aim clockwise', async ({ page }) => {
            const delta = await page.evaluate(() => {
                startGame();
                aimAt(LAUNCHER.x + 100, LAUNCHER.y);
                const before = launcher.angle;
                launcher.spin = 1;
                step(0.1);
                return launcher.angle - before;
            });
            expect(delta).toBeGreaterThan(0);
        });

        test('holding ArrowLeft rotates the aim anticlockwise', async ({ page }) => {
            const delta = await page.evaluate(async () => {
                startGame();
                aimAt(LAUNCHER.x + 100, LAUNCHER.y);
                const before = launcher.angle;
                window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft' }));
                step(0.1);
                window.dispatchEvent(new KeyboardEvent('keyup', { key: 'ArrowLeft' }));
                return launcher.angle - before;
            });
            expect(delta).toBeLessThan(0);
        });

        test('mouse movement over the canvas aims the launcher', async ({ page }) => {
            await page.evaluate(() => startGame());
            const box = await page.locator('#canvas').boundingBox();
            await page.mouse.move(box.x + box.width - 5, box.y + box.height / 2);
            const angle = await page.evaluate(() => launcher.angle);
            expect(Math.abs(angle)).toBeLessThan(0.4);
        });
    });

    // -----------------------------------------------------------------------
    // Shooting
    // -----------------------------------------------------------------------
    test.describe('shooting', () => {
        test('shoot launches the loaded marble along the aim', async ({ page }) => {
            const s = await page.evaluate(() => {
                startGame();
                aimAt(LAUNCHER.x + 100, LAUNCHER.y);
                launcher.current = 2;
                shoot();
                const shot = shots[0];
                return {
                    n: shots.length,
                    color: shot.color,
                    vx: shot.vx,
                    vy: shot.vy,
                    speedRatio: Math.hypot(shot.vx, shot.vy) / SHOT_SPEED,
                };
            });
            expect(s.n).toBe(1);
            expect(s.color).toBe(2);
            expect(s.vy).toBeCloseTo(0, 5);
            expect(s.vx).toBeGreaterThan(0);
            expect(s.speedRatio).toBeCloseTo(1, 5);
        });

        test('firing advances the queued marble into the launcher', async ({ page }) => {
            const s = await page.evaluate(() => {
                startGame();
                launcher.current = 0;
                launcher.next = 1;
                shoot();
                return { current: launcher.current, fired: shots[0].color };
            });
            expect(s.fired).toBe(0);
            expect(s.current).toBe(1);
        });

        test('swapping exchanges the loaded and next marbles', async ({ page }) => {
            const s = await page.evaluate(() => {
                startGame();
                launcher.current = 0;
                launcher.next = 4;
                swapBall();
                return [launcher.current, launcher.next];
            });
            expect(s).toEqual([4, 0]);
        });

        test('S swaps the marbles from the keyboard', async ({ page }) => {
            await page.evaluate(() => { startGame(); launcher.current = 1; launcher.next = 5; });
            await page.keyboard.press('s');
            expect(await page.evaluate(() => [launcher.current, launcher.next])).toEqual([5, 1]);
        });

        test('a shot travels in its aimed direction', async ({ page }) => {
            const s = await page.evaluate(() => {
                startGame();
                aimAt(LAUNCHER.x + 100, LAUNCHER.y);
                shoot();
                const x0 = shots[0].x;
                step(0.05);
                return { moved: shots.length ? shots[0].x - x0 : null };
            });
            expect(s.moved).toBeGreaterThan(10);
        });

        test('a shot that leaves the canvas is discarded', async ({ page }) => {
            const n = await page.evaluate(() => {
                startGame();
                aimAt(LAUNCHER.x + 100, LAUNCHER.y);
                shoot();
                step(2);
                return shots.length;
            });
            expect(n).toBe(0);
        });

        test('clicking the canvas fires a marble', async ({ page }) => {
            await page.evaluate(() => startGame());
            const box = await page.locator('#canvas').boundingBox();
            await page.mouse.click(box.x + box.width - 8, box.y + box.height / 2);
            expect(await page.evaluate(() => shots.length)).toBe(1);
        });

        test('Space fires once the run is under way', async ({ page }) => {
            await page.evaluate(() => startGame());
            await page.keyboard.press('Space');
            expect(await page.evaluate(() => shots.length)).toBe(1);
        });
    });

    // -----------------------------------------------------------------------
    // Chain motion
    // -----------------------------------------------------------------------
    test.describe('chain', () => {
        test('the front marble crawls toward the pit', async ({ page }) => {
            const moved = await page.evaluate(() => {
                startGame();
                setChain([0, 1, 2], 300);
                const before = balls[0].d;
                step(1);
                return balls[0].d - before;
            });
            expect(moved).toBeCloseTo(26, 1);
        });

        test('followers keep one diameter of spacing', async ({ page }) => {
            const gaps = await page.evaluate(() => {
                startGame();
                setChain([0, 1, 2, 3], 300);
                step(0.5);
                return balls.slice(1).map((b, i) => balls[i].d - b.d);
            });
            for (const g of gaps) expect(g).toBeCloseTo(28, 3);
        });

        test('a detached tail catches up with the marbles ahead', async ({ page }) => {
            const gap = await page.evaluate(() => {
                startGame();
                setChain([0, 1, 2], 300);
                balls[2].d -= 120;           // knock the tail back
                step(1.5);
                return balls[1].d - balls[2].d;
            });
            expect(gap).toBeCloseTo(28, 1);
        });

        test('queued marbles are released onto the track over time', async ({ page }) => {
            const s = await page.evaluate(() => {
                startGame();
                const queued = spawnQueue.length;
                step(4);
                return { onTrack: balls.length, queued, left: spawnQueue.length };
            });
            expect(s.onTrack).toBeGreaterThan(1);
            expect(s.left).toBe(s.queued - s.onTrack);
        });

        test('the chain never advances while paused', async ({ page }) => {
            const same = await page.evaluate(() => {
                startGame();
                setChain([0, 1, 2], 300);
                togglePause();
                const before = balls[0].d;
                step(1);
                return balls[0].d === before;
            });
            expect(same).toBe(true);
        });
    });

    // -----------------------------------------------------------------------
    // Insertion and matching
    // -----------------------------------------------------------------------
    test.describe('inserting and matching', () => {
        test('a marble inserted in front pushes the rest back', async ({ page }) => {
            const s = await page.evaluate(() => {
                startGame();
                setChain([0, 1, 2], 400);
                insertBall(1, 5, 'front');
                return { colors: balls.map(b => b.color), ds: balls.map(b => b.d) };
            });
            expect(s.colors).toEqual([0, 5, 1, 2]);
            expect(s.ds[0] - s.ds[1]).toBeCloseTo(28, 3);
            expect(s.ds[1] - s.ds[2]).toBeCloseTo(28, 3);
        });

        test('a marble inserted behind lands after its neighbour', async ({ page }) => {
            const colors = await page.evaluate(() => {
                startGame();
                setChain([0, 1, 2], 400);
                insertBall(1, 5, 'back');
                return balls.map(b => b.color);
            });
            expect(colors).toEqual([0, 1, 5, 2]);
        });

        test('three of a colour pop and score', async ({ page }) => {
            const s = await page.evaluate(() => {
                startGame();
                setChain([1, 2, 2, 1], 400);
                const popped = insertBall(2, 2, 'front');
                return { popped, colors: balls.map(b => b.color), score };
            });
            expect(s.popped).toBe(3);
            expect(s.colors).toEqual([1, 1]);
            expect(s.score).toBe(30);
        });

        test('two of a colour do not pop', async ({ page }) => {
            const s = await page.evaluate(() => {
                startGame();
                setChain([1, 2, 3], 400);
                const popped = insertBall(1, 2, 'front');
                return { popped, len: balls.length, score };
            });
            expect(s).toEqual({ popped: 0, len: 4, score: 0 });
        });

        test('marbles separated by a gap do not match across it', async ({ page }) => {
            const s = await page.evaluate(() => {
                startGame();
                setChain([2, 2, 2], 400);
                const touching = matchRun(1).len;
                balls[2].d -= 90;                // detach the trailing marble
                return { touching, detached: matchRun(1).len, len: balls.length };
            });
            expect(s.touching).toBe(3);
            expect(s.detached).toBe(2);
            expect(s.len).toBe(3);
        });

        test('a pop that brings like colours together chains a combo', async ({ page }) => {
            const s = await page.evaluate(() => {
                startGame();
                setChain([4, 4, 1, 1, 4, 4], 500);
                const popped = insertBall(2, 1, 'front');  // completes 1,1,1
                return { popped, colors: balls.map(b => b.color), score };
            });
            // three 1s pop, then the 4s meet and pop as a x2 combo
            expect(s.popped).toBe(7);
            expect(s.colors).toEqual([]);
            expect(s.score).toBe(3 * 10 + 4 * 10 * 2);
        });

        test('a fired marble embeds itself in the chain it hits', async ({ page }) => {
            const s = await page.evaluate(() => {
                startGame();
                setChain([0, 1, 2, 3, 4], 600);
                const target = pathPos(balls[2].d);
                aimAt(target.x, target.y);
                shoot();
                for (let i = 0; i < 60 && shots.length; i++) step(1 / 60);
                return { shots: shots.length, len: balls.length };
            });
            expect(s.shots).toBe(0);
            expect(s.len).toBe(6);
        });

        test('a fired marble completing a run pops it', async ({ page }) => {
            const s = await page.evaluate(() => {
                startGame();
                setChain([3, 3, 0, 0], 600);
                launcher.current = 3;
                const target = pathPos(balls[0].d);
                aimAt(target.x, target.y);
                shoot();
                for (let i = 0; i < 90 && shots.length; i++) step(1 / 60);
                return { colors: balls.map(b => b.color), score };
            });
            expect(s.colors).toEqual([0, 0]);
            expect(s.score).toBeGreaterThan(0);
        });
    });

    // -----------------------------------------------------------------------
    // Level flow and game over
    // -----------------------------------------------------------------------
    test.describe('level flow', () => {
        test('clearing the track advances to the next level', async ({ page }) => {
            const s = await page.evaluate(() => {
                startGame();
                spawnQueue.length = 0;
                setChain([1, 1], 400);
                insertBall(0, 1, 'front');
                step(1 / 60);
                return { level, queued: spawnQueue.length, balls: balls.length, score, state };
            });
            expect(s.level).toBe(2);
            // the fresh level's chain — some of it may already be on the track
            expect(s.queued + s.balls).toBe(30);
            expect(s.state).toBe('running');
            expect(s.score).toBeGreaterThanOrEqual(130);
        });

        test('the level readout updates', async ({ page }) => {
            await page.evaluate(() => {
                startGame();
                spawnQueue.length = 0;
                balls.length = 0;
                step(1 / 60);
            });
            await expect(page.locator('#level')).toHaveText('2');
        });

        test('a marble reaching the pit ends the run', async ({ page }) => {
            const s = await page.evaluate(() => {
                startGame();
                setChain([0, 1, 2], PATH_LEN - 5);
                step(1);
                return state;
            });
            expect(s).toBe('over');
            await expect(page.locator('#overlay')).toHaveClass(/visible/);
            await expect(page.locator('#overlay-title')).toContainText(/over/i);
        });

        test('the best score is stored after a run ends', async ({ page }) => {
            const best = await page.evaluate(() => {
                startGame();
                score = 777;
                setChain([0], PATH_LEN - 1);
                step(1);
                return window.localStorage.getItem('marble-popper-best');
            });
            expect(best).toBe('777');
            await expect(page.locator('#best')).toHaveText('777');
        });

        test('a lower score does not overwrite the best', async ({ page }) => {
            const best = await page.evaluate(() => {
                window.localStorage.setItem('marble-popper-best', '900');
                loadBest();
                startGame();
                score = 100;
                setChain([0], PATH_LEN - 1);
                step(1);
                return window.localStorage.getItem('marble-popper-best');
            });
            expect(best).toBe('900');
        });
    });

    // -----------------------------------------------------------------------
    // HUD, pausing and restarting
    // -----------------------------------------------------------------------
    test.describe('hud and flow', () => {
        test('the score readout updates after a pop', async ({ page }) => {
            await page.evaluate(() => {
                startGame();
                setChain([1, 1], 400);
                insertBall(0, 1, 'front');
                updateHud();
            });
            await expect(page.locator('#score')).toHaveText(/^\d+$/);
            expect(await page.evaluate(() => Number(document.getElementById('score').textContent))).toBeGreaterThan(0);
        });

        test('the remaining readout counts the track and the queue', async ({ page }) => {
            await page.evaluate(() => {
                startGame();
                setChain([1, 2], 400);       // also empties the queue
                spawnQueue.push(0, 1, 2);
                updateHud();
            });
            await expect(page.locator('#remaining')).toHaveText('5');
        });

        test('P pauses and resumes', async ({ page }) => {
            await page.evaluate(() => startGame());
            await page.keyboard.press('p');
            expect(await page.evaluate(() => state)).toBe('paused');
            await expect(page.locator('#overlay')).toHaveClass(/visible/);
            await page.keyboard.press('p');
            expect(await page.evaluate(() => state)).toBe('running');
            await expect(page.locator('#overlay')).not.toHaveClass(/visible/);
        });

        test('shots do not fire while paused', async ({ page }) => {
            const n = await page.evaluate(() => {
                startGame();
                togglePause();
                shoot();
                return shots.length;
            });
            expect(n).toBe(0);
        });

        test('Space restarts after a game over', async ({ page }) => {
            await page.evaluate(() => {
                startGame();
                score = 50;
                setChain([0], PATH_LEN - 1);
                step(1);
            });
            await page.keyboard.press('Space');
            const s = await page.evaluate(() => ({ state, score, level }));
            expect(s).toEqual({ state: 'running', score: 0, level: 1 });
        });

        test('the canvas is actually painted', async ({ page }) => {
            const painted = await page.evaluate(() => {
                startGame();
                setChain([0, 1, 2], 400);
                draw();
                const ctx2 = document.getElementById('canvas').getContext('2d');
                const data = ctx2.getImageData(0, 0, CANVAS_W, CANVAS_H).data;
                const seen = new Set();
                for (let i = 0; i < data.length; i += 4) {
                    seen.add(data[i] + ',' + data[i + 1] + ',' + data[i + 2]);
                    if (seen.size > 4) return true;
                }
                return false;
            });
            expect(painted).toBe(true);
        });
    });
});
