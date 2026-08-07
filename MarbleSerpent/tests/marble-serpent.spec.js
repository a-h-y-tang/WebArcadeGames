const { test, expect } = require('@playwright/test');
const path = require('path');
const { pathToFileURL } = require('url');

const GAME_URL = pathToFileURL(path.resolve(__dirname, '../index.html')).href;

// Mirrors the game's own MARBLE_SPACING so assertions can be written in Node
// scope. Inside page.evaluate the page's global of the same name is used.
const MARBLE_SPACING = 26;

test.describe('Marble Serpent', () => {
    test.beforeEach(async ({ page }) => {
        await page.goto(GAME_URL);
    });

    // -----------------------------------------------------------------------
    // Initial / idle state
    // -----------------------------------------------------------------------
    test.describe('initial state', () => {
        test('page title is Marble Serpent', async ({ page }) => {
            await expect(page).toHaveTitle('Marble Serpent');
        });

        test('start overlay is visible', async ({ page }) => {
            await expect(page.locator('#overlay')).toHaveClass(/visible/);
        });

        test('overlay prompts the player to start', async ({ page }) => {
            await expect(page.locator('#overlay-sub')).toContainText(/space|start/i);
        });

        test('score, level, lives and best show their starting values', async ({ page }) => {
            await expect(page.locator('#score')).toHaveText('0');
            await expect(page.locator('#level')).toHaveText('1');
            await expect(page.locator('#lives')).toHaveText('3');
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

        test('no marbles and no shots before starting', async ({ page }) => {
            const counts = await page.evaluate(() => ({ m: marbles.length, s: shots.length }));
            expect(counts).toEqual({ m: 0, s: 0 });
        });

        test('best score loads from localStorage', async ({ page }) => {
            await page.evaluate(() => window.localStorage.setItem('marble-serpent-best', '4210'));
            await page.reload();
            await expect(page.locator('#best')).toHaveText('4210');
        });

        test('stepping while idle does nothing', async ({ page }) => {
            const count = await page.evaluate(() => {
                for (let i = 0; i < 60; i++) step(0.016);
                return marbles.length;
            });
            expect(count).toBe(0);
        });
    });

    // -----------------------------------------------------------------------
    // The path
    // -----------------------------------------------------------------------
    test.describe('path', () => {
        test('the path has a positive length', async ({ page }) => {
            expect(await page.evaluate(() => pathLength())).toBeGreaterThan(1000);
        });

        test('pathPoint returns points inside a sane bounding box', async ({ page }) => {
            const ok = await page.evaluate(() => {
                const len = pathLength();
                for (let i = 0; i <= 100; i++) {
                    const p = pathPoint((len * i) / 100);
                    if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) return false;
                    if (p.y < -60 || p.y > CANVAS_H + 60) return false;
                    if (p.x < -80 || p.x > CANVAS_W + 80) return false;
                }
                return true;
            });
            expect(ok).toBe(true);
        });

        test('pathPoint advances monotonically in arc length', async ({ page }) => {
            const ok = await page.evaluate(() => {
                const len = pathLength();
                let prev = pathPoint(0);
                for (let d = 5; d <= len; d += 5) {
                    const p = pathPoint(d);
                    const step = Math.hypot(p.x - prev.x, p.y - prev.y);
                    // consecutive 5px samples should be roughly 5px apart
                    if (step < 1 || step > 12) return false;
                    prev = p;
                }
                return true;
            });
            expect(ok).toBe(true);
        });

        test('pathPoint clamps beyond both ends', async ({ page }) => {
            const clamped = await page.evaluate(() => {
                const len = pathLength();
                const a = pathPoint(-500), start = pathPoint(0);
                const b = pathPoint(len + 500), end = pathPoint(len);
                return {
                    startSame: a.x === start.x && a.y === start.y,
                    endSame: b.x === end.x && b.y === end.y,
                };
            });
            expect(clamped).toEqual({ startSame: true, endSame: true });
        });

        test('the cannon sits clear of the track', async ({ page }) => {
            const clearance = await page.evaluate(() => {
                const len = pathLength();
                let min = Infinity;
                for (let d = 0; d <= len; d += 2) {
                    const p = pathPoint(d);
                    min = Math.min(min, Math.hypot(p.x - shooter.x, p.y - shooter.y));
                }
                return min;
            });
            expect(clearance).toBeGreaterThan(40);
        });
    });

    // -----------------------------------------------------------------------
    // Starting
    // -----------------------------------------------------------------------
    test.describe('starting', () => {
        test('Space starts the game and hides the overlay', async ({ page }) => {
            await page.keyboard.press('Space');
            expect(await page.evaluate(() => state)).toBe('running');
            await expect(page.locator('#overlay')).not.toHaveClass(/visible/);
        });

        test('Start button starts the game', async ({ page }) => {
            await page.locator('#btn-start').click();
            expect(await page.evaluate(() => state)).toBe('running');
        });

        test('a new game begins on level 1 with 3 lives and no score', async ({ page }) => {
            const s = await page.evaluate(() => { startGame(); return { level, lives, score }; });
            expect(s).toEqual({ level: 1, lives: 3, score: 0 });
        });

        test('the level queue is filled at the start of a level', async ({ page }) => {
            const q = await page.evaluate(() => { startGame(); return queue.length; });
            expect(q).toBe(32);
        });

        test('the cannon is loaded with a current and a next colour', async ({ page }) => {
            const loaded = await page.evaluate(() => {
                startGame();
                return {
                    current: COLORS.includes(shooter.current),
                    next: COLORS.includes(shooter.next),
                };
            });
            expect(loaded).toEqual({ current: true, next: true });
        });
    });

    // -----------------------------------------------------------------------
    // The crawling serpent
    // -----------------------------------------------------------------------
    test.describe('the serpent', () => {
        test('marbles emerge from the start of the path', async ({ page }) => {
            const count = await page.evaluate(() => {
                startGame();
                for (let i = 0; i < 120; i++) step(0.016);
                return marbles.length;
            });
            expect(count).toBeGreaterThan(0);
        });

        test('spawning consumes the queue', async ({ page }) => {
            const { before, after } = await page.evaluate(() => {
                startGame();
                const before = queue.length;
                for (let i = 0; i < 300; i++) step(0.016);
                return { before, after: queue.length };
            });
            expect(after).toBeLessThan(before);
        });

        test('the head crawls toward the pit', async ({ page }) => {
            const { before, after } = await page.evaluate(() => {
                startGame();
                marbles.length = 0;
                queue.length = 0;
                marbles.push({ d: 200, color: COLORS[0] });
                const before = marbles[0].d;
                for (let i = 0; i < 60; i++) step(0.016);
                return { before, after: marbles[0].d };
            });
            expect(after).toBeGreaterThan(before);
        });

        test('the chain stays evenly spaced with no overlap', async ({ page }) => {
            const minGap = await page.evaluate(() => {
                startGame();
                for (let i = 0; i < 600; i++) step(0.016);
                let min = Infinity;
                for (let i = 1; i < marbles.length; i++) {
                    min = Math.min(min, marbles[i - 1].d - marbles[i].d);
                }
                return marbles.length > 1 ? min : Infinity;
            });
            expect(minGap).toBeGreaterThanOrEqual(MARBLE_SPACING - 0.01);
        });

        test('a detached tail sprints forward to close the gap', async ({ page }) => {
            const result = await page.evaluate(() => {
                startGame();
                queue.length = 0;
                marbles.length = 0;
                marbles.push({ d: 400, color: COLORS[0] });
                marbles.push({ d: 200, color: COLORS[1] });
                const gapBefore = marbles[0].d - marbles[1].d;
                for (let i = 0; i < 30; i++) step(0.016);
                return { gapBefore, gapAfter: marbles[0].d - marbles[1].d };
            });
            expect(result.gapAfter).toBeLessThan(result.gapBefore);
        });

        test('marbles emerging from the mouth never pop on their own', async ({ page }) => {
            const r = await page.evaluate(() => {
                startGame();
                marbles.length = 0;
                queue.length = 0;
                for (let i = 0; i < 8; i++) queue.push(COLORS[0]); // all one colour
                score = 0;
                for (let i = 0; i < 600; i++) step(0.016);
                return { count: marbles.length, score, queue: queue.length };
            });
            expect(r.queue).toBe(0);
            expect(r.count).toBe(8);
            expect(r.score).toBe(0);
        });

        test('the tail catches up faster than the head crawls', async ({ page }) => {
            const speeds = await page.evaluate(() => ({
                crawl: chainSpeed(),
                catchup: CATCHUP_SPEED,
            }));
            expect(speeds.catchup).toBeGreaterThan(speeds.crawl * 3);
        });

        test('later levels crawl faster', async ({ page }) => {
            const { l1, l5 } = await page.evaluate(() => {
                startGame();
                const l1 = chainSpeed();
                level = 5;
                return { l1, l5: chainSpeed() };
            });
            expect(l5).toBeGreaterThan(l1);
        });

        test('later levels use more colours, capped at the palette size', async ({ page }) => {
            const c = await page.evaluate(() => ({
                l1: colorsForLevel(1),
                l3: colorsForLevel(3),
                l50: colorsForLevel(50),
                palette: COLORS.length,
            }));
            expect(c.l1).toBe(3);
            expect(c.l3).toBeGreaterThan(c.l1);
            expect(c.l50).toBe(c.palette);
        });
    });

    // -----------------------------------------------------------------------
    // Aiming and firing
    // -----------------------------------------------------------------------
    test.describe('aiming and firing', () => {
        test('aimAt points the cannon at the given position', async ({ page }) => {
            const angle = await page.evaluate(() => {
                startGame();
                aimAt(shooter.x, shooter.y - 100);
                return shooter.angle;
            });
            expect(angle).toBeCloseTo(-Math.PI / 2, 3);
        });

        test('arrow keys rotate the aim', async ({ page }) => {
            await page.evaluate(() => { startGame(); aimAt(shooter.x, shooter.y - 100); });
            const before = await page.evaluate(() => shooter.angle);
            await page.keyboard.down('ArrowRight');
            await page.evaluate(() => { for (let i = 0; i < 10; i++) step(0.016); });
            await page.keyboard.up('ArrowRight');
            const after = await page.evaluate(() => shooter.angle);
            expect(after).toBeGreaterThan(before);
        });

        test('shooting launches a marble from the cannon', async ({ page }) => {
            const shot = await page.evaluate(() => {
                startGame();
                aimAt(shooter.x, shooter.y - 100);
                shots.length = 0;
                shoot();
                return { count: shots.length, x: shots[0].x, y: shots[0].y, vy: shots[0].vy };
            });
            expect(shot.count).toBe(1);
            expect(shot.x).toBeCloseTo(300, 0);
            expect(shot.vy).toBeLessThan(0);
        });

        test('a shot carries the loaded colour and reloads the cannon', async ({ page }) => {
            const r = await page.evaluate(() => {
                startGame();
                shots.length = 0;
                const loaded = shooter.current, queued = shooter.next;
                shoot();
                return { fired: shots[0].color, loaded, promoted: shooter.current === queued };
            });
            expect(r.fired).toBe(r.loaded);
            expect(r.promoted).toBe(true);
        });

        test('swapping exchanges the loaded and queued colours', async ({ page }) => {
            const r = await page.evaluate(() => {
                startGame();
                shooter.current = COLORS[0];
                shooter.next = COLORS[1];
                swapMarble();
                return { current: shooter.current, next: shooter.next };
            });
            expect(r).toEqual({ current: '#ffd24d', next: '#ff4d5e' });
        });

        test('shots travel in a straight line', async ({ page }) => {
            const r = await page.evaluate(() => {
                startGame();
                marbles.length = 0;
                aimAt(shooter.x, shooter.y - 100);
                shots.length = 0;
                shoot();
                const y0 = shots[0].y;
                step(0.05);
                return { y0, y1: shots[0].y };
            });
            expect(r.y1).toBeLessThan(r.y0 - 10);
        });

        test('shots that leave the canvas are discarded', async ({ page }) => {
            const count = await page.evaluate(() => {
                startGame();
                marbles.length = 0;
                aimAt(shooter.x, shooter.y - 100);
                shots.length = 0;
                shoot();
                for (let i = 0; i < 120; i++) step(0.016);
                return shots.length;
            });
            expect(count).toBe(0);
        });

        test('clicking the canvas fires a marble', async ({ page }) => {
            await page.evaluate(() => { startGame(); marbles.length = 0; shots.length = 0; });
            await page.locator('#canvas').click({ position: { x: 300, y: 100 } });
            expect(await page.evaluate(() => shots.length)).toBe(1);
        });

        test('firing does nothing while paused', async ({ page }) => {
            const count = await page.evaluate(() => {
                startGame();
                togglePause();
                shots.length = 0;
                shoot();
                return shots.length;
            });
            expect(count).toBe(0);
        });
    });

    // -----------------------------------------------------------------------
    // Insertion
    // -----------------------------------------------------------------------
    test.describe('insertion', () => {
        test('a shot that reaches the chain is absorbed into it', async ({ page }) => {
            const r = await page.evaluate(() => {
                startGame();
                queue.length = 0;
                marbles.length = 0;
                const d0 = pathLength() * 0.72;
                marbles.push({ d: d0, color: COLORS[0] });
                marbles.push({ d: d0 - MARBLE_SPACING, color: COLORS[1] });
                marbles.push({ d: d0 - 2 * MARBLE_SPACING, color: COLORS[2] });
                shooter.current = COLORS[3];
                const target = pathPoint(marbles[1].d);
                aimAt(target.x, target.y);
                shots.length = 0;
                shoot();
                for (let i = 0; i < 120; i++) step(0.016);
                return { marbles: marbles.length, shots: shots.length };
            });
            expect(r.marbles).toBe(4);
            expect(r.shots).toBe(0);
        });

        test('insertMarble splices a marble into the chain at the given index', async ({ page }) => {
            const colors = await page.evaluate(() => {
                startGame();
                queue.length = 0;
                marbles.length = 0;
                marbles.push({ d: 300, color: COLORS[0] });
                marbles.push({ d: 300 - MARBLE_SPACING, color: COLORS[1] });
                insertMarble(COLORS[2], 1);
                return marbles.map((m) => m.color);
            });
            expect(colors).toEqual(['#ff4d5e', '#4dd2ff', '#ffd24d']);
        });

        test('insertion pushes the tail backwards, never the head forwards', async ({ page }) => {
            const r = await page.evaluate(() => {
                startGame();
                queue.length = 0;
                marbles.length = 0;
                marbles.push({ d: 300, color: COLORS[0] });
                marbles.push({ d: 300 - MARBLE_SPACING, color: COLORS[1] });
                const headBefore = marbles[0].d;
                insertMarble(COLORS[2], 1);
                return { headBefore, headAfter: marbles[0].d, tail: marbles[2].d };
            });
            expect(r.headAfter).toBe(r.headBefore);
            expect(r.tail).toBe(300 - 2 * MARBLE_SPACING);
        });

        test('inserted marbles keep the chain properly spaced', async ({ page }) => {
            const minGap = await page.evaluate(() => {
                startGame();
                queue.length = 0;
                marbles.length = 0;
                for (let i = 0; i < 6; i++) {
                    marbles.push({ d: 400 - i * MARBLE_SPACING, color: COLORS[i % 3] });
                }
                insertMarble(COLORS[4], 3);
                let min = Infinity;
                for (let i = 1; i < marbles.length; i++) {
                    min = Math.min(min, marbles[i - 1].d - marbles[i].d);
                }
                return min;
            });
            expect(minGap).toBeGreaterThanOrEqual(MARBLE_SPACING - 0.01);
        });

        test('insertion preserves a gap further down the tail', async ({ page }) => {
            const gap = await page.evaluate(() => {
                startGame();
                queue.length = 0;
                marbles.length = 0;
                marbles.push({ d: 400, color: COLORS[0] });
                marbles.push({ d: 400 - MARBLE_SPACING, color: COLORS[1] });
                marbles.push({ d: 200, color: COLORS[2] }); // detached tail
                insertMarble(COLORS[3], 1);
                return marbles[3].d;
            });
            expect(gap).toBe(200);
        });
    });

    // -----------------------------------------------------------------------
    // Matching
    // -----------------------------------------------------------------------
    test.describe('matching', () => {
        test('findRun measures a run of touching same-coloured marbles', async ({ page }) => {
            const run = await page.evaluate(() => {
                startGame();
                queue.length = 0;
                marbles.length = 0;
                const c = [0, 1, 1, 1, 2].map((i) => COLORS[i]);
                c.forEach((color, i) => marbles.push({ d: 400 - i * MARBLE_SPACING, color }));
                return findRun(2);
            });
            expect(run).toEqual({ start: 1, length: 3 });
        });

        test('findRun does not reach across a gap', async ({ page }) => {
            const run = await page.evaluate(() => {
                startGame();
                queue.length = 0;
                marbles.length = 0;
                marbles.push({ d: 400, color: COLORS[0] });
                marbles.push({ d: 400 - MARBLE_SPACING, color: COLORS[0] });
                marbles.push({ d: 200, color: COLORS[0] }); // same colour, detached
                return findRun(0);
            });
            expect(run).toEqual({ start: 0, length: 2 });
        });

        test('three of a colour pop and score', async ({ page }) => {
            const r = await page.evaluate(() => {
                startGame();
                queue.length = 0;
                marbles.length = 0;
                marbles.push({ d: 400, color: COLORS[0] });
                marbles.push({ d: 400 - MARBLE_SPACING, color: COLORS[0] });
                marbles.push({ d: 400 - 2 * MARBLE_SPACING, color: COLORS[1] });
                score = 0;
                insertMarble(COLORS[0], 2);
                return { count: marbles.length, score };
            });
            expect(r.count).toBe(1);
            expect(r.score).toBe(3 * 10);
        });

        test('two of a colour do not pop', async ({ page }) => {
            const r = await page.evaluate(() => {
                startGame();
                queue.length = 0;
                marbles.length = 0;
                marbles.push({ d: 400, color: COLORS[0] });
                marbles.push({ d: 400 - MARBLE_SPACING, color: COLORS[1] });
                score = 0;
                insertMarble(COLORS[0], 2);
                return { count: marbles.length, score };
            });
            expect(r.count).toBe(3);
            expect(r.score).toBe(0);
        });

        test('longer runs score proportionally more', async ({ page }) => {
            const score = await page.evaluate(() => {
                startGame();
                queue.length = 0;
                marbles.length = 0;
                for (let i = 0; i < 4; i++) {
                    marbles.push({ d: 400 - i * MARBLE_SPACING, color: COLORS[0] });
                }
                score = 0;
                insertMarble(COLORS[0], 2);
                return score;
            });
            expect(score).toBe(5 * 10);
        });

        test('the HUD score updates when marbles pop', async ({ page }) => {
            await page.evaluate(() => {
                startGame();
                queue.length = 0;
                marbles.length = 0;
                marbles.push({ d: 400, color: COLORS[0] });
                marbles.push({ d: 400 - MARBLE_SPACING, color: COLORS[0] });
                insertMarble(COLORS[0], 2);
                togglePause(); // freeze the live animation loop before asserting
            });
            await expect(page.locator('#score')).toHaveText('30');
        });
    });

    // -----------------------------------------------------------------------
    // Chain reactions
    // -----------------------------------------------------------------------
    test.describe('chain reactions', () => {
        // Both cascade tests keep one lone "sentinel" marble far down the tail so
        // the board never empties mid-test, which would clear the level and add
        // its bonus to the score under measurement.
        test('a gap closing on matching colours pops a second group', async ({ page }) => {
            const r = await page.evaluate(() => {
                startGame();
                queue.length = 0;
                marbles.length = 0;
                // front pair, then a popping trio, then a matching single behind
                marbles.push({ d: 500, color: COLORS[1] });
                marbles.push({ d: 500 - MARBLE_SPACING, color: COLORS[1] });
                marbles.push({ d: 500 - 2 * MARBLE_SPACING, color: COLORS[0] });
                marbles.push({ d: 500 - 3 * MARBLE_SPACING, color: COLORS[0] });
                marbles.push({ d: 500 - 4 * MARBLE_SPACING, color: COLORS[1] });
                marbles.push({ d: 40, color: COLORS[2] }); // sentinel
                score = 0;
                // insert a third COLORS[0] -> that trio pops, leaving
                // [c1, c1] ... [c1] with a gap that then closes into a trio.
                insertMarble(COLORS[0], 4);
                const afterPop = marbles.length;
                for (let i = 0; i < 120; i++) step(0.016);
                return { afterPop, remaining: marbles.length, score };
            });
            expect(r.afterPop).toBe(4); // three survivors plus the sentinel
            expect(r.remaining).toBe(1); // only the sentinel is left
            expect(r.score).toBeGreaterThan(6 * 10);
        });

        test('a chain reaction scores with a rising combo multiplier', async ({ page }) => {
            const r = await page.evaluate(() => {
                startGame();
                queue.length = 0;
                marbles.length = 0;
                marbles.push({ d: 500, color: COLORS[1] });
                marbles.push({ d: 500 - MARBLE_SPACING, color: COLORS[1] });
                marbles.push({ d: 500 - 2 * MARBLE_SPACING, color: COLORS[0] });
                marbles.push({ d: 500 - 3 * MARBLE_SPACING, color: COLORS[0] });
                marbles.push({ d: 500 - 4 * MARBLE_SPACING, color: COLORS[1] });
                marbles.push({ d: 40, color: COLORS[2] }); // sentinel
                score = 0;
                insertMarble(COLORS[0], 4);
                const first = score;
                for (let i = 0; i < 120; i++) step(0.016);
                const second = score - first;
                return { first, second };
            });
            // both groups are three marbles, but the cascade is worth double
            expect(r.first).toBe(30);
            expect(r.second).toBe(60);
        });

        test('a gap closing on mismatched colours pops nothing', async ({ page }) => {
            const r = await page.evaluate(() => {
                startGame();
                queue.length = 0;
                marbles.length = 0;
                marbles.push({ d: 500, color: COLORS[0] });
                marbles.push({ d: 500 - MARBLE_SPACING, color: COLORS[0] });
                marbles.push({ d: 420, color: COLORS[1] });
                score = 0;
                for (let i = 0; i < 200; i++) step(0.016);
                return { count: marbles.length, score };
            });
            expect(r.count).toBe(3);
            expect(r.score).toBe(0);
        });
    });

    // -----------------------------------------------------------------------
    // Reaching the pit
    // -----------------------------------------------------------------------
    test.describe('the pit', () => {
        test('a marble reaching the pit costs a life', async ({ page }) => {
            const lives = await page.evaluate(() => {
                startGame();
                marbles.length = 0;
                marbles.push({ d: pathLength() - 1, color: COLORS[0] });
                for (let i = 0; i < 30; i++) step(0.016);
                return lives;
            });
            expect(lives).toBe(2);
        });

        test('losing a life restarts the level with a fresh serpent', async ({ page }) => {
            const r = await page.evaluate(() => {
                startGame();
                level = 2;
                score = 500;
                marbles.length = 0;
                queue.length = 0;
                marbles.push({ d: pathLength() - 1, color: COLORS[0] });
                for (let i = 0; i < 30; i++) step(0.016);
                return {
                    level,
                    score,
                    headD: marbles.length ? marbles[0].d : 0,
                    queue: queue.length,
                };
            });
            expect(r.level).toBe(2);
            expect(r.score).toBe(500);
            expect(r.headD).toBeLessThan(100); // the serpent restarted at the mouth
            expect(r.queue).toBeGreaterThan(0);
        });

        test('losing the last life ends the game', async ({ page }) => {
            const s = await page.evaluate(() => {
                startGame();
                lives = 1;
                marbles.length = 0;
                marbles.push({ d: pathLength() - 1, color: COLORS[0] });
                for (let i = 0; i < 30; i++) step(0.016);
                return state;
            });
            expect(s).toBe('over');
        });

        test('the HUD shows the remaining lives', async ({ page }) => {
            await page.evaluate(() => {
                startGame();
                marbles.length = 0;
                marbles.push({ d: pathLength() - 1, color: COLORS[0] });
                for (let i = 0; i < 30; i++) step(0.016);
                togglePause(); // freeze the live animation loop before asserting
            });
            await expect(page.locator('#lives')).toHaveText('2');
        });
    });

    // -----------------------------------------------------------------------
    // Levels
    // -----------------------------------------------------------------------
    test.describe('levels', () => {
        test('clearing every marble advances the level', async ({ page }) => {
            const r = await page.evaluate(() => {
                startGame();
                marbles.length = 0;
                queue.length = 0;
                for (let i = 0; i < 10; i++) step(0.016);
                return { level, queue: queue.length, marbles: marbles.length };
            });
            expect(r.level).toBe(2);
            expect(r.queue).toBeGreaterThan(0);
        });

        test('clearing a level awards a bonus', async ({ page }) => {
            const score = await page.evaluate(() => {
                startGame();
                score = 0;
                marbles.length = 0;
                queue.length = 0;
                for (let i = 0; i < 10; i++) step(0.016);
                return score;
            });
            expect(score).toBe(200);
        });

        test('later levels start with a longer serpent', async ({ page }) => {
            const r = await page.evaluate(() => ({
                l1: queueSizeForLevel(1),
                l4: queueSizeForLevel(4),
            }));
            expect(r.l4).toBeGreaterThan(r.l1);
        });

        test('the HUD shows the level', async ({ page }) => {
            await page.evaluate(() => {
                startGame();
                marbles.length = 0;
                queue.length = 0;
                for (let i = 0; i < 10; i++) step(0.016);
            });
            await expect(page.locator('#level')).toHaveText('2');
        });

        test('a level in progress does not advance', async ({ page }) => {
            const level = await page.evaluate(() => {
                startGame();
                for (let i = 0; i < 120; i++) step(0.016);
                return level;
            });
            expect(level).toBe(1);
        });
    });

    // -----------------------------------------------------------------------
    // Loaded colours
    // -----------------------------------------------------------------------
    test.describe('loaded colours', () => {
        test('the cannon only loads colours that are still in play', async ({ page }) => {
            const ok = await page.evaluate(() => {
                startGame();
                queue.length = 0;
                marbles.length = 0;
                marbles.push({ d: 400, color: COLORS[2] });
                marbles.push({ d: 400 - MARBLE_SPACING, color: COLORS[2] });
                // two reloads to flush whatever the level started with
                reloadCannon();
                reloadCannon();
                for (let i = 0; i < 30; i++) {
                    if (shooter.current !== COLORS[2] || shooter.next !== COLORS[2]) return false;
                    reloadCannon();
                }
                return true;
            });
            expect(ok).toBe(true);
        });

        test('an empty board still yields a valid colour', async ({ page }) => {
            const ok = await page.evaluate(() => {
                startGame();
                queue.length = 0;
                marbles.length = 0;
                reloadCannon();
                return COLORS.includes(shooter.current) && COLORS.includes(shooter.next);
            });
            expect(ok).toBe(true);
        });
    });

    // -----------------------------------------------------------------------
    // Pause, game over and best score
    // -----------------------------------------------------------------------
    test.describe('pause, game over and best score', () => {
        test('pausing freezes the serpent', async ({ page }) => {
            const r = await page.evaluate(() => {
                startGame();
                queue.length = 0;
                marbles.length = 0;
                marbles.push({ d: 300, color: COLORS[0] });
                togglePause();
                const before = marbles[0].d;
                for (let i = 0; i < 20; i++) step(0.016);
                return { before, after: marbles[0].d };
            });
            expect(r.after).toBe(r.before);
        });

        test('resuming lets the serpent crawl again', async ({ page }) => {
            const moved = await page.evaluate(() => {
                startGame();
                queue.length = 0;
                marbles.length = 0;
                marbles.push({ d: 300, color: COLORS[0] });
                togglePause();
                togglePause();
                const before = marbles[0].d;
                for (let i = 0; i < 20; i++) step(0.016);
                return marbles[0].d > before;
            });
            expect(moved).toBe(true);
        });

        test('P toggles the pause', async ({ page }) => {
            await page.keyboard.press('Space');
            await page.keyboard.press('KeyP');
            expect(await page.evaluate(() => state)).toBe('paused');
            await page.keyboard.press('KeyP');
            expect(await page.evaluate(() => state)).toBe('running');
        });

        test('game over shows the overlay with Play Again', async ({ page }) => {
            await page.evaluate(() => { startGame(); endGame(); });
            await expect(page.locator('#overlay')).toHaveClass(/visible/);
            await expect(page.locator('#btn-start')).toHaveText('Play Again');
        });

        test('best score updates on game over when beaten', async ({ page }) => {
            await page.evaluate(() => { startGame(); score = 1234; endGame(); });
            await expect(page.locator('#best')).toHaveText('1234');
        });

        test('best score persists to localStorage', async ({ page }) => {
            await page.evaluate(() => { startGame(); score = 777; endGame(); });
            const stored = await page.evaluate(() => window.localStorage.getItem('marble-serpent-best'));
            expect(parseInt(stored, 10)).toBe(777);
        });

        test('best score is not lowered by a worse run', async ({ page }) => {
            await page.evaluate(() => window.localStorage.setItem('marble-serpent-best', '9000'));
            await page.reload();
            await page.evaluate(() => { startGame(); score = 5; endGame(); });
            await expect(page.locator('#best')).toHaveText('9000');
        });

        test('restarting resets score, level, lives, marbles and shots', async ({ page }) => {
            const r = await page.evaluate(() => {
                startGame();
                score = 999;
                level = 7;
                lives = 1;
                marbles.push({ d: 100, color: COLORS[0] });
                shots.push({ x: 0, y: 0, vx: 0, vy: 0, color: COLORS[0] });
                endGame();
                startGame();
                return {
                    score, level, lives,
                    marbles: marbles.length,
                    shots: shots.length,
                    state,
                };
            });
            expect(r).toEqual({ score: 0, level: 1, lives: 3, marbles: 0, shots: 0, state: 'running' });
        });
    });
});
