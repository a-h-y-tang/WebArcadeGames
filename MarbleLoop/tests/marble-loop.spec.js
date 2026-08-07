const { test, expect } = require('@playwright/test');
const path = require('path');
const { pathToFileURL } = require('url');

const GAME_URL = pathToFileURL(path.resolve(__dirname, '../index.html')).href;

test.describe('Marble Loop', () => {
    test.beforeEach(async ({ page }) => {
        await page.goto(GAME_URL);
    });

    // -----------------------------------------------------------------------
    // Initial / idle state
    // -----------------------------------------------------------------------
    test.describe('initial state', () => {
        test('page title is Marble Loop', async ({ page }) => {
            await expect(page).toHaveTitle('Marble Loop');
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

        test('no marbles and no balls before starting', async ({ page }) => {
            const s = await page.evaluate(() => ({ n: chain.colors.length, b: balls.length }));
            expect(s.n).toBe(0);
            expect(s.b).toBe(0);
        });

        test('best score loads from localStorage', async ({ page }) => {
            await page.evaluate(() => window.localStorage.setItem('marble-loop-best', '4210'));
            await page.reload();
            await expect(page.locator('#best')).toHaveText('4210');
        });
    });

    // -----------------------------------------------------------------------
    // The spiral path
    // -----------------------------------------------------------------------
    test.describe('path', () => {
        test('path is long enough to hold a chain', async ({ page }) => {
            expect(await page.evaluate(() => pathLength)).toBeGreaterThan(1000);
        });

        test('sample points are about 1px apart', async ({ page }) => {
            const worst = await page.evaluate(() => {
                let worst = 0;
                for (let d = 0; d < pathLength; d++) {
                    const a = pathPoint(d), b = pathPoint(d + 1);
                    worst = Math.max(worst, Math.hypot(b.x - a.x, b.y - a.y));
                }
                return worst;
            });
            expect(worst).toBeLessThan(2);
        });

        test('every path point is inside the canvas', async ({ page }) => {
            const inside = await page.evaluate(() => {
                for (let d = 0; d <= pathLength; d++) {
                    const p = pathPoint(d);
                    if (p.x < 0 || p.x > CANVAS_W || p.y < 0 || p.y > CANVAS_H) return false;
                }
                return true;
            });
            expect(inside).toBe(true);
        });

        test('pathPoint clamps out-of-range distances to the ends', async ({ page }) => {
            const same = await page.evaluate(() => {
                const start = pathPoint(0), before = pathPoint(-500);
                const end = pathPoint(pathLength), after = pathPoint(pathLength + 500);
                return before.x === start.x && before.y === start.y
                    && after.x === end.x && after.y === end.y;
            });
            expect(same).toBe(true);
        });

        test('the path ends at the hole', async ({ page }) => {
            const gap = await page.evaluate(() => {
                const p = pathPoint(pathLength);
                return Math.hypot(p.x - hole.x, p.y - hole.y);
            });
            expect(gap).toBeLessThan(2);
        });

        test('nearestPathDistance recovers the distance of a point on the path', async ({ page }) => {
            const errors = await page.evaluate(() => {
                const out = [];
                for (const d of [0, 200, 700, 1300, pathLength - 5]) {
                    const p = pathPoint(d);
                    out.push(Math.abs(nearestPathDistance(p.x, p.y) - d));
                }
                return out;
            });
            for (const err of errors) expect(err).toBeLessThan(6);
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

        test('a new game begins on level 1 with a zero score', async ({ page }) => {
            const s = await page.evaluate(() => { startGame(); return { level, score, head: chain.head }; });
            expect(s.level).toBe(1);
            expect(s.score).toBe(0);
            expect(s.head).toBe(0);
        });

        test('the level queue holds the right number of marbles', async ({ page }) => {
            const s = await page.evaluate(() => {
                startGame();
                return { queued: queue.length, chain: chain.colors.length, total: levelMarbles() };
            });
            expect(s.queued + s.chain).toBe(s.total);
            expect(s.total).toBe(28);
        });

        test('the first marble is on the board straight away', async ({ page }) => {
            expect(await page.evaluate(() => { startGame(); return chain.colors.length; })).toBe(1);
        });

        test('the launcher is loaded with two playable colours', async ({ page }) => {
            const ok = await page.evaluate(() => {
                startGame();
                const palette = levelColors();
                return palette.includes(shooter.current) && palette.includes(shooter.next);
            });
            expect(ok).toBe(true);
        });

        test('the launcher sits at the centre of the spiral', async ({ page }) => {
            const s = await page.evaluate(() => ({ x: shooter.x, y: shooter.y }));
            expect(s.x).toBeCloseTo(320, 0);
            expect(s.y).toBeCloseTo(240, 0);
        });
    });

    // -----------------------------------------------------------------------
    // The chain
    // -----------------------------------------------------------------------
    test.describe('chain', () => {
        test('the chain advances along the path over time', async ({ page }) => {
            const s = await page.evaluate(() => {
                startGame();
                const before = chain.head;
                step(1);
                return { before, after: chain.head, speed: chainSpeed() };
            });
            expect(s.after).toBeCloseTo(s.before + s.speed, 3);
        });

        test('marbles are spaced evenly behind the head', async ({ page }) => {
            const s = await page.evaluate(() => {
                startGame();
                for (let i = 0; i < 200; i++) step(1 / 60);
                return { n: chain.colors.length, d0: marbleDistance(0), d1: marbleDistance(1), gap: SPACING };
            });
            expect(s.n).toBeGreaterThan(2);
            expect(s.d0 - s.d1).toBeCloseTo(s.gap, 6);
        });

        test('marblePos follows the path', async ({ page }) => {
            const off = await page.evaluate(() => {
                startGame();
                for (let i = 0; i < 120; i++) step(1 / 60);
                const p = marblePos(0), q = pathPoint(marbleDistance(0));
                return Math.hypot(p.x - q.x, p.y - q.y);
            });
            expect(off).toBeLessThan(0.001);
        });

        test('marbles feed onto the board from the queue', async ({ page }) => {
            const s = await page.evaluate(() => {
                startGame();
                const queued = queue.length;
                for (let i = 0; i < 600; i++) step(1 / 60);
                return { queued, left: queue.length, n: chain.colors.length };
            });
            expect(s.left).toBeLessThan(s.queued);
            expect(s.n).toBeGreaterThan(1);
        });

        test('no more marbles appear once the queue is empty', async ({ page }) => {
            const s = await page.evaluate(() => {
                startGame();
                queue.length = 0;
                const n = chain.colors.length;
                for (let i = 0; i < 300; i++) step(1 / 60);
                return { before: n, after: chain.colors.length };
            });
            expect(s.after).toBe(s.before);
        });

        test('the chain does not advance while paused', async ({ page }) => {
            const s = await page.evaluate(() => {
                startGame();
                togglePause();
                const before = chain.head;
                step(1);
                return { before, after: chain.head, state };
            });
            expect(s.state).toBe('paused');
            expect(s.after).toBe(s.before);
        });
    });

    // -----------------------------------------------------------------------
    // Aiming
    // -----------------------------------------------------------------------
    test.describe('aiming', () => {
        test('aimAt points the launcher at a board position', async ({ page }) => {
            const angle = await page.evaluate(() => {
                startGame();
                aimAt(shooter.x + 100, shooter.y);
                return shooter.angle;
            });
            expect(angle).toBeCloseTo(0, 5);
        });

        test('aimAt handles a target below the launcher', async ({ page }) => {
            const angle = await page.evaluate(() => {
                startGame();
                aimAt(shooter.x, shooter.y + 100);
                return shooter.angle;
            });
            expect(angle).toBeCloseTo(Math.PI / 2, 5);
        });

        test('moving the mouse over the canvas re-aims the launcher', async ({ page }) => {
            await page.evaluate(() => startGame());
            const box = await page.locator('#canvas').boundingBox();
            await page.mouse.move(box.x + box.width - 5, box.y + box.height / 2);
            const angle = await page.evaluate(() => shooter.angle);
            expect(Math.abs(angle)).toBeLessThan(0.3);
        });

        test('arrow keys rotate the launcher', async ({ page }) => {
            await page.evaluate(() => { startGame(); setAim(0); });
            await page.keyboard.press('ArrowLeft');
            expect(await page.evaluate(() => shooter.angle)).toBeLessThan(0);
            await page.keyboard.press('ArrowRight');
            await page.keyboard.press('ArrowRight');
            expect(await page.evaluate(() => shooter.angle)).toBeGreaterThan(0);
        });
    });

    // -----------------------------------------------------------------------
    // Shooting
    // -----------------------------------------------------------------------
    test.describe('shooting', () => {
        test('shooting launches a ball in the current colour', async ({ page }) => {
            const s = await page.evaluate(() => {
                startGame();
                const colour = shooter.current;
                setAim(0);
                shootMarble();
                return { n: balls.length, colour, ballColour: balls[0].color };
            });
            expect(s.n).toBe(1);
            expect(s.ballColour).toBe(s.colour);
        });

        test('the next marble is promoted after a shot', async ({ page }) => {
            const s = await page.evaluate(() => {
                startGame();
                const next = shooter.next;
                shootMarble();
                return { next, current: shooter.current };
            });
            expect(s.current).toBe(s.next);
        });

        test('a fired ball travels along the aim direction', async ({ page }) => {
            const s = await page.evaluate(() => {
                startGame();
                chain.colors.length = 0;
                setAim(0);
                shootMarble();
                const x0 = balls[0].x, y0 = balls[0].y;
                step(0.05);
                return { x0, y0, x1: balls[0].x, y1: balls[0].y };
            });
            expect(s.x1).toBeGreaterThan(s.x0);
            expect(s.y1).toBeCloseTo(s.y0, 3);
        });

        test('a ball that leaves the board is discarded', async ({ page }) => {
            const n = await page.evaluate(() => {
                startGame();
                queue.length = 0;          // stop the level feeding new marbles
                setAim(-Math.PI / 2);      // fire straight up, over empty track
                shootMarble();
                for (let i = 0; i < 120; i++) step(1 / 60);
                return balls.length;
            });
            expect(n).toBe(0);
        });

        test('swapping exchanges the current and next marbles', async ({ page }) => {
            const s = await page.evaluate(() => {
                startGame();
                shooter.current = 'A';
                shooter.next = 'B';
                swapMarbles();
                return { current: shooter.current, next: shooter.next };
            });
            expect(s.current).toBe('B');
            expect(s.next).toBe('A');
        });

        test('the S key swaps the marbles', async ({ page }) => {
            await page.evaluate(() => { startGame(); shooter.current = 'A'; shooter.next = 'B'; });
            await page.keyboard.press('s');
            const s = await page.evaluate(() => ({ current: shooter.current, next: shooter.next }));
            expect(s.current).toBe('B');
            expect(s.next).toBe('A');
        });

        test('shooting is refused when the game is not running', async ({ page }) => {
            const s = await page.evaluate(() => {
                const fired = shootMarble();
                return { fired, n: balls.length };
            });
            expect(s.fired).toBe(false);
            expect(s.n).toBe(0);
        });

        test('clicking the board fires a marble', async ({ page }) => {
            await page.evaluate(() => startGame());
            const box = await page.locator('#canvas').boundingBox();
            // Click near the top edge: the track up there is still empty, so the
            // ball is guaranteed to be in flight when we look.
            await page.mouse.click(box.x + box.width / 2, box.y + 10);
            expect(await page.evaluate(() => balls.length)).toBe(1);
        });

        test('no more than MAX_BALLS may be in flight', async ({ page }) => {
            const n = await page.evaluate(() => {
                startGame();
                chain.colors.length = 0;
                for (let i = 0; i < 10; i++) shootMarble();
                return balls.length;
            });
            expect(n).toBeLessThanOrEqual(3);
        });
    });

    // -----------------------------------------------------------------------
    // Insertion and matching
    // -----------------------------------------------------------------------
    test.describe('matching', () => {
        test('a non-matching marble joins the chain', async ({ page }) => {
            const s = await page.evaluate(() => {
                startGame();
                chain.head = 600;
                chain.colors = ['red', 'blue', 'green'];
                const removed = insertMarble(1, 'gold');
                return { removed, colors: chain.colors };
            });
            expect(s.removed).toBe(0);
            expect(s.colors).toEqual(['red', 'gold', 'blue', 'green']);
        });

        test('completing three of a colour clears them', async ({ page }) => {
            const s = await page.evaluate(() => {
                startGame();
                score = 0;
                chain.head = 600;
                chain.colors = ['red', 'red', 'blue'];
                const removed = insertMarble(2, 'red');
                return { removed, colors: chain.colors, score };
            });
            expect(s.removed).toBe(3);
            expect(s.colors).toEqual(['blue']);
            expect(s.score).toBeGreaterThan(0);
        });

        test('a match inside the chain removes only the matching run', async ({ page }) => {
            const colors = await page.evaluate(() => {
                startGame();
                chain.head = 900;
                chain.colors = ['blue', 'red', 'red', 'green', 'green'];
                insertMarble(1, 'red');
                return chain.colors;
            });
            expect(colors).toEqual(['blue', 'green', 'green']);
        });

        test('a run longer than three is cleared entirely', async ({ page }) => {
            const s = await page.evaluate(() => {
                startGame();
                chain.head = 900;
                chain.colors = ['red', 'red', 'red', 'red'];
                const removed = insertMarble(0, 'red');
                return { removed, n: chain.colors.length };
            });
            expect(s.removed).toBe(5);
            expect(s.n).toBe(0);
        });

        test('closing a gap can cascade into a second match', async ({ page }) => {
            const s = await page.evaluate(() => {
                startGame();
                score = 0;
                chain.head = 1200;
                // gold-gold | blue blue blue | gold-gold  →  inserting blue clears the
                // blues, and the golds meet to make four.
                chain.colors = ['gold', 'gold', 'blue', 'blue', 'gold', 'gold'];
                const removed = insertMarble(4, 'blue');
                return { removed, n: chain.colors.length, combo, score };
            });
            expect(s.removed).toBe(7);
            expect(s.n).toBe(0);
            expect(s.combo).toBe(2);
        });

        test('a cascade scores more than the same marbles without one', async ({ page }) => {
            const s = await page.evaluate(() => {
                startGame();
                score = 0;
                chain.head = 1200;
                chain.colors = ['gold', 'gold', 'blue', 'blue', 'gold', 'gold'];
                insertMarble(4, 'blue');
                const cascade = score;
                score = 0;
                chain.colors = ['blue', 'blue', 'red'];
                insertMarble(2, 'blue');
                return { cascade, plain: score };
            });
            expect(s.cascade).toBeGreaterThan(s.plain * 2);
        });

        test('a ball that hits the chain is inserted and removed from flight', async ({ page }) => {
            const s = await page.evaluate(() => {
                startGame();
                queue.length = 0;
                chain.head = 800;
                chain.colors = ['red', 'blue', 'green', 'gold'];
                const target = marblePos(1);
                balls.length = 0;
                balls.push({ x: target.x, y: target.y, vx: 0, vy: 0, color: 'teal' });
                step(1 / 60);
                return { n: chain.colors.length, flying: balls.length, has: chain.colors.includes('teal') };
            });
            expect(s.flying).toBe(0);
            expect(s.n).toBe(5);
            expect(s.has).toBe(true);
        });

        test('a ball lands on the side of the marble it struck', async ({ page }) => {
            const colors = await page.evaluate(() => {
                startGame();
                queue.length = 0;
                chain.head = 800;
                chain.colors = ['red', 'blue', 'green', 'gold'];
                // Aim at a point between marbles 2 and 3, slightly behind marble 2.
                const p = pathPoint(marbleDistance(2) - SPACING * 0.4);
                balls.length = 0;
                balls.push({ x: p.x, y: p.y, vx: 0, vy: 0, color: 'teal' });
                step(1 / 60);
                return chain.colors;
            });
            expect(colors.indexOf('teal')).toBe(3);
        });
    });

    // -----------------------------------------------------------------------
    // Levels
    // -----------------------------------------------------------------------
    test.describe('levels', () => {
        test('difficulty scales with the level', async ({ page }) => {
            const s = await page.evaluate(() => {
                startGame();
                const one = { speed: chainSpeed(), marbles: levelMarbles(), colors: levelColors().length };
                level = 5;
                const five = { speed: chainSpeed(), marbles: levelMarbles(), colors: levelColors().length };
                return { one, five };
            });
            expect(s.five.speed).toBeGreaterThan(s.one.speed);
            expect(s.five.marbles).toBeGreaterThan(s.one.marbles);
            expect(s.five.colors).toBeGreaterThan(s.one.colors);
        });

        test('the palette never exceeds the available colours', async ({ page }) => {
            const s = await page.evaluate(() => {
                startGame();
                level = 50;
                return { n: levelColors().length, max: COLORS.length };
            });
            expect(s.n).toBe(s.max);
        });

        test('clearing every marble advances to the next level with a bonus', async ({ page }) => {
            const s = await page.evaluate(() => {
                startGame();
                score = 0;
                queue.length = 0;
                chain.head = 900;
                chain.colors = ['red', 'red'];
                insertMarble(0, 'red');
                step(1 / 60);
                return { level, score, head: chain.head, queued: queue.length, state };
            });
            expect(s.level).toBe(2);
            expect(s.score).toBeGreaterThanOrEqual(500);
            expect(s.head).toBe(0);
            expect(s.queued).toBeGreaterThan(0);
            expect(s.state).toBe('running');
        });

        test('an empty chain with marbles still queued does not end the level', async ({ page }) => {
            const s = await page.evaluate(() => {
                startGame();
                chain.colors.length = 0;
                chain.head = 100;
                step(1 / 60);
                return { level, n: chain.colors.length };
            });
            expect(s.level).toBe(1);
            expect(s.n).toBeGreaterThan(0);
        });

        test('the HUD shows how many marbles are left in the level', async ({ page }) => {
            await page.evaluate(() => startGame());
            const shown = await page.locator('#marbles').textContent();
            const expected = await page.evaluate(() => chain.colors.length + queue.length);
            expect(Number(shown)).toBe(expected);
        });
    });

    // -----------------------------------------------------------------------
    // Losing
    // -----------------------------------------------------------------------
    test.describe('game over', () => {
        test('the chain reaching the hole ends the game', async ({ page }) => {
            const s = await page.evaluate(() => {
                startGame();
                chain.head = pathLength - 1;
                step(1);
                return state;
            });
            expect(s).toBe('over');
            await expect(page.locator('#overlay')).toHaveClass(/visible/);
            await expect(page.locator('#overlay-title')).toContainText(/over/i);
        });

        test('the final score is shown on the overlay', async ({ page }) => {
            await page.evaluate(() => {
                startGame();
                score = 1234;
                chain.head = pathLength;
                step(1 / 60);
            });
            await expect(page.locator('#overlay-score')).toContainText('1234');
        });

        test('the best score is stored and reloaded', async ({ page }) => {
            await page.evaluate(() => {
                startGame();
                score = 777;
                chain.head = pathLength;
                step(1 / 60);
            });
            await expect(page.locator('#best')).toHaveText('777');
            expect(await page.evaluate(() => window.localStorage.getItem('marble-loop-best'))).toBe('777');
        });

        test('a lower score does not overwrite the best', async ({ page }) => {
            await page.evaluate(() => window.localStorage.setItem('marble-loop-best', '5000'));
            await page.reload();
            await page.evaluate(() => {
                startGame();
                score = 10;
                chain.head = pathLength;
                step(1 / 60);
            });
            expect(await page.evaluate(() => window.localStorage.getItem('marble-loop-best'))).toBe('5000');
        });

        test('the world is frozen after the game ends', async ({ page }) => {
            const s = await page.evaluate(() => {
                startGame();
                chain.head = pathLength;
                step(1 / 60);
                const head = chain.head;
                step(1);
                return { head, after: chain.head };
            });
            expect(s.after).toBe(s.head);
        });

        test('Space restarts after a game over', async ({ page }) => {
            await page.evaluate(() => {
                startGame();
                score = 99;
                chain.head = pathLength;
                step(1 / 60);
            });
            await page.keyboard.press('Space');
            const s = await page.evaluate(() => ({ state, score, level }));
            expect(s.state).toBe('running');
            expect(s.score).toBe(0);
            expect(s.level).toBe(1);
        });
    });

    // -----------------------------------------------------------------------
    // Pausing and restarting
    // -----------------------------------------------------------------------
    test.describe('pause and restart', () => {
        test('P pauses and resumes', async ({ page }) => {
            await page.evaluate(() => startGame());
            await page.keyboard.press('p');
            expect(await page.evaluate(() => state)).toBe('paused');
            await expect(page.locator('#overlay')).toHaveClass(/visible/);
            await page.keyboard.press('p');
            expect(await page.evaluate(() => state)).toBe('running');
            await expect(page.locator('#overlay')).not.toHaveClass(/visible/);
        });

        test('R restarts a game in progress', async ({ page }) => {
            await page.evaluate(() => { startGame(); score = 400; level = 3; });
            await page.keyboard.press('r');
            const s = await page.evaluate(() => ({ state, score, level }));
            expect(s.state).toBe('running');
            expect(s.score).toBe(0);
            expect(s.level).toBe(1);
        });

        test('shooting is refused while paused', async ({ page }) => {
            const s = await page.evaluate(() => {
                startGame();
                togglePause();
                return { fired: shootMarble(), n: balls.length };
            });
            expect(s.fired).toBe(false);
            expect(s.n).toBe(0);
        });
    });

    // -----------------------------------------------------------------------
    // Rendering / animation loop
    // -----------------------------------------------------------------------
    test.describe('rendering', () => {
        test('the canvas is painted', async ({ page }) => {
            await page.evaluate(() => { startGame(); for (let i = 0; i < 60; i++) step(1 / 60); draw(); });
            const painted = await page.evaluate(() => {
                const px = canvas.getContext('2d').getImageData(0, 0, CANVAS_W, CANVAS_H).data;
                const seen = new Set();
                for (let i = 0; i < px.length; i += 4) seen.add(`${px[i]},${px[i + 1]},${px[i + 2]}`);
                return seen.size;
            });
            expect(painted).toBeGreaterThan(10);
        });

        test('the animation loop advances the chain on its own', async ({ page }) => {
            await page.evaluate(() => startGame());
            const before = await page.evaluate(() => chain.head);
            await page.waitForTimeout(400);
            const after = await page.evaluate(() => chain.head);
            expect(after).toBeGreaterThan(before);
        });

        test('the HUD tracks the score', async ({ page }) => {
            await page.evaluate(() => {
                startGame();
                score = 0;
                chain.head = 900;
                chain.colors = ['red', 'red', 'blue'];
                insertMarble(0, 'red');
            });
            const shown = Number(await page.locator('#score').textContent());
            expect(shown).toBeGreaterThan(0);
            expect(shown).toBe(await page.evaluate(() => score));
        });
    });
});
