const { test, expect } = require('@playwright/test');
const path = require('path');
const { pathToFileURL } = require('url');

const GAME_URL = pathToFileURL(path.resolve(__dirname, '../index.html')).href;

// Build a deterministic chain of marbles for a test. `colors` is front-first,
// `headT` is the distance along the track of the front-most marble.
function seedChain(page, colors, headT = 300) {
    return page.evaluate(
        ({ colors, headT }) => {
            startGame();
            pending = 0;
            projectiles.length = 0;
            chain.length = 0;
            colors.forEach((color, i) => chain.push({ t: headT - i * SPACING, color }));
        },
        { colors, headT }
    );
}

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

        test('canvas is 640x480', async ({ page }) => {
            const canvas = page.locator('#canvas');
            await expect(canvas).toHaveAttribute('width', '640');
            await expect(canvas).toHaveAttribute('height', '480');
        });

        test('start overlay is visible and prompts the player', async ({ page }) => {
            await expect(page.locator('#overlay')).toHaveClass(/visible/);
            await expect(page.locator('#overlay-sub')).toContainText(/space|start|click/i);
        });

        test('score, level and best show their starting values', async ({ page }) => {
            await expect(page.locator('#score')).toHaveText('0');
            await expect(page.locator('#level')).toHaveText('1');
            await expect(page.locator('#best')).toHaveText('0');
        });

        test('state is idle with no marbles in play', async ({ page }) => {
            const s = await page.evaluate(() => ({ state, chain: chain.length, shots: projectiles.length }));
            expect(s.state).toBe('idle');
            expect(s.chain).toBe(0);
            expect(s.shots).toBe(0);
        });

        test('best score loads from localStorage', async ({ page }) => {
            await page.evaluate(() => window.localStorage.setItem('marble-loop-best', '4210'));
            await page.reload();
            await expect(page.locator('#best')).toHaveText('4210');
        });

        test('at least four marble colours are available', async ({ page }) => {
            expect(await page.evaluate(() => COLORS.length)).toBeGreaterThanOrEqual(4);
        });
    });

    // -----------------------------------------------------------------------
    // The track
    // -----------------------------------------------------------------------
    test.describe('path', () => {
        test('has a positive length', async ({ page }) => {
            expect(await page.evaluate(() => pathLength())).toBeGreaterThan(500);
        });

        test('pointAt(0) is the start of the track', async ({ page }) => {
            const same = await page.evaluate(() => {
                const p = pointAt(0);
                const first = path.points[0];
                return Math.hypot(p.x - first.x, p.y - first.y) < 1;
            });
            expect(same).toBe(true);
        });

        test('pointAt clamps beyond both ends', async ({ page }) => {
            const r = await page.evaluate(() => {
                const before = pointAt(-500);
                const after = pointAt(pathLength() + 500);
                const end = pointAt(pathLength());
                const start = pointAt(0);
                return {
                    beforeOk: Math.hypot(before.x - start.x, before.y - start.y) < 1,
                    afterOk: Math.hypot(after.x - end.x, after.y - end.y) < 1,
                };
            });
            expect(r.beforeOk).toBe(true);
            expect(r.afterOk).toBe(true);
        });

        test('distance travelled matches the parameter', async ({ page }) => {
            const d = await page.evaluate(() => {
                const a = pointAt(100);
                const b = pointAt(140);
                return Math.hypot(b.x - a.x, b.y - a.y);
            });
            // The track curves, so the straight-line distance is at most the arc
            // length but should still be close over a short span.
            expect(d).toBeLessThanOrEqual(40.5);
            expect(d).toBeGreaterThan(25);
        });

        test('tangentAt returns a unit vector', async ({ page }) => {
            const lens = await page.evaluate(() => {
                const out = [];
                for (const t of [0, 50, 200, pathLength()]) {
                    const d = tangentAt(t);
                    out.push(Math.hypot(d.x, d.y));
                }
                return out;
            });
            for (const len of lens) expect(len).toBeCloseTo(1, 3);
        });

        test('every point of the track lies inside the canvas', async ({ page }) => {
            const inside = await page.evaluate(() =>
                path.points.every((p) => p.x >= 0 && p.x <= CANVAS_W && p.y >= 0 && p.y <= CANVAS_H)
            );
            expect(inside).toBe(true);
        });

        test('the turret sits inside the canvas', async ({ page }) => {
            const ok = await page.evaluate(
                () => shooter.x > 0 && shooter.x < CANVAS_W && shooter.y > 0 && shooter.y < CANVAS_H
            );
            expect(ok).toBe(true);
        });

        test('each level rebuilds the track', async ({ page }) => {
            const lengths = await page.evaluate(() => {
                const out = [];
                for (let n = 1; n <= 3; n++) {
                    startLevel(n);
                    out.push(pathLength());
                }
                return out;
            });
            for (const len of lengths) expect(len).toBeGreaterThan(500);
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

        test('the start button starts the game', async ({ page }) => {
            await page.locator('#btn-start').click();
            expect(await page.evaluate(() => state)).toBe('running');
        });

        test('a new game begins on level 1 with a full queue and no score', async ({ page }) => {
            const s = await page.evaluate(() => {
                startGame();
                return { level, score, pending, chain: chain.length };
            });
            expect(s.level).toBe(1);
            expect(s.score).toBe(0);
            expect(s.pending).toBeGreaterThan(10);
            expect(s.chain).toBe(0);
        });

        test('the turret is loaded with a current and a next marble', async ({ page }) => {
            const s = await page.evaluate(() => {
                startGame();
                return { current: shooter.current, next: shooter.next, colors: COLORS };
            });
            expect(s.colors).toContain(s.current);
            expect(s.colors).toContain(s.next);
        });

        test('later levels are harder than level 1', async ({ page }) => {
            const s = await page.evaluate(() => ({ a: levelConfig(1), b: levelConfig(5) }));
            expect(s.b.speed).toBeGreaterThan(s.a.speed);
            expect(s.b.marbles).toBeGreaterThan(s.a.marbles);
            expect(s.b.colorCount).toBeGreaterThanOrEqual(s.a.colorCount);
        });

        test('the colour count never exceeds the palette', async ({ page }) => {
            const ok = await page.evaluate(() => {
                for (let n = 1; n <= 40; n++) {
                    const c = levelConfig(n);
                    if (c.colorCount < 3 || c.colorCount > COLORS.length) return false;
                }
                return true;
            });
            expect(ok).toBe(true);
        });
    });

    // -----------------------------------------------------------------------
    // The marching chain
    // -----------------------------------------------------------------------
    test.describe('chain movement', () => {
        test('the head of the chain advances along the track', async ({ page }) => {
            const s = await seedChain(page, ['red', 'blue', 'green']).then(() =>
                page.evaluate(() => {
                    const before = chain[0].t;
                    for (let i = 0; i < 30; i++) step(0.016);
                    return { before, after: chain[0].t };
                })
            );
            expect(s.after).toBeGreaterThan(s.before);
        });

        test('marbles keep their spacing while marching', async ({ page }) => {
            await seedChain(page, ['red', 'blue', 'green', 'yellow']);
            const ok = await page.evaluate(() => {
                for (let i = 0; i < 60; i++) step(0.016);
                return chain.every((m, i) => i === 0 || chain[i - 1].t - m.t >= SPACING - 0.01);
            });
            expect(ok).toBe(true);
        });

        test('queued marbles enter the track from the start', async ({ page }) => {
            const s = await page.evaluate(() => {
                startGame();
                chain.length = 0;
                const before = pending;
                for (let i = 0; i < 200; i++) step(0.016);
                return { before, after: pending, chain: chain.length, tail: chain.length ? chain[chain.length - 1].t : -1 };
            });
            expect(s.after).toBeLessThan(s.before);
            expect(s.chain).toBeGreaterThan(0);
            expect(s.tail).toBeGreaterThanOrEqual(0);
        });

        test('a gap behind the head closes over time', async ({ page }) => {
            await page.evaluate(() => {
                startGame();
                pending = 0;
                chain.length = 0;
                chain.push({ t: 300, color: 'red' });
                chain.push({ t: 300 - SPACING, color: 'red' });
                chain.push({ t: 120, color: 'blue' }); // deliberate gap
            });
            const s = await page.evaluate(() => {
                const gapBefore = chain[1].t - chain[2].t;
                for (let i = 0; i < 120; i++) step(0.016);
                return { gapBefore, gapAfter: chain[1].t - chain[2].t };
            });
            expect(s.gapBefore).toBeGreaterThan(30);
            expect(s.gapAfter).toBeLessThan(s.gapBefore);
        });

        test('the rear segment catches up faster than the head advances', async ({ page }) => {
            const ok = await page.evaluate(() => catchupSpeed() > chainSpeed());
            expect(ok).toBe(true);
        });

        test('nothing moves while the game is idle', async ({ page }) => {
            const s = await page.evaluate(() => {
                chain.length = 0;
                chain.push({ t: 100, color: 'red' });
                for (let i = 0; i < 30; i++) step(0.016);
                return chain[0].t;
            });
            expect(s).toBe(100);
        });
    });

    // -----------------------------------------------------------------------
    // Aiming and shooting
    // -----------------------------------------------------------------------
    test.describe('shooting', () => {
        test('aimAt points the turret at the target', async ({ page }) => {
            const s = await page.evaluate(() => {
                startGame();
                aimAt(shooter.x + 100, shooter.y);
                const right = shooter.angle;
                aimAt(shooter.x, shooter.y + 100);
                const down = shooter.angle;
                return { right, down };
            });
            expect(s.right).toBeCloseTo(0, 3);
            expect(s.down).toBeCloseTo(Math.PI / 2, 3);
        });

        test('shooting launches the loaded marble and reloads', async ({ page }) => {
            const s = await page.evaluate(() => {
                startGame();
                const loaded = shooter.current;
                const queued = shooter.next;
                shoot();
                return { loaded, queued, fired: projectiles[0] ? projectiles[0].color : null, current: shooter.current, shots: projectiles.length };
            });
            expect(s.shots).toBe(1);
            expect(s.fired).toBe(s.loaded);
            expect(s.current).toBe(s.queued);
        });

        test('only one marble can be in flight at a time', async ({ page }) => {
            const n = await page.evaluate(() => {
                startGame();
                shoot();
                shoot();
                shoot();
                return projectiles.length;
            });
            expect(n).toBe(1);
        });

        test('a fired marble travels along the aim direction', async ({ page }) => {
            const s = await page.evaluate(() => {
                startGame();
                chain.length = 0;
                pending = 0;
                aimAt(shooter.x + 100, shooter.y);
                shoot();
                const before = { x: projectiles[0].x, y: projectiles[0].y };
                step(0.05);
                const p = projectiles[0];
                return { before, after: { x: p.x, y: p.y } };
            });
            expect(s.after.x).toBeGreaterThan(s.before.x);
            expect(Math.abs(s.after.y - s.before.y)).toBeLessThan(1);
        });

        test('a marble that misses everything leaves play', async ({ page }) => {
            const n = await page.evaluate(() => {
                startGame();
                chain.length = 0;
                pending = 0;
                aimAt(shooter.x, shooter.y - 100);
                shoot();
                for (let i = 0; i < 200; i++) step(0.016);
                return projectiles.length;
            });
            expect(n).toBe(0);
        });

        test('swapping exchanges the loaded and queued marbles', async ({ page }) => {
            const s = await page.evaluate(() => {
                startGame();
                shooter.current = 'red';
                shooter.next = 'blue';
                swapMarble();
                return { current: shooter.current, next: shooter.next };
            });
            expect(s.current).toBe('blue');
            expect(s.next).toBe('red');
        });

        test('the S key swaps marbles', async ({ page }) => {
            await page.evaluate(() => {
                startGame();
                shooter.current = 'red';
                shooter.next = 'blue';
            });
            await page.keyboard.press('s');
            expect(await page.evaluate(() => shooter.current)).toBe('blue');
        });

        test('queued colours are drawn from colours still on the track', async ({ page }) => {
            const ok = await page.evaluate(() => {
                startGame();
                pending = 0;
                chain.length = 0;
                chain.push({ t: 300, color: 'red' });
                chain.push({ t: 300 - SPACING, color: 'red' });
                for (let i = 0; i < 20; i++) {
                    if (pickColor() !== 'red') return false;
                }
                return true;
            });
            expect(ok).toBe(true);
        });

        test('mouse movement aims the turret', async ({ page }) => {
            await page.evaluate(() => startGame());
            const box = await page.locator('#canvas').boundingBox();
            await page.mouse.move(box.x + box.width - 5, box.y + box.height / 2);
            const angle = await page.evaluate(() => shooter.angle);
            expect(Math.abs(angle)).toBeLessThan(0.6);
        });
    });

    // -----------------------------------------------------------------------
    // Collision and insertion
    // -----------------------------------------------------------------------
    test.describe('insertion', () => {
        test('hitTest finds the marble under a point', async ({ page }) => {
            await seedChain(page, ['red', 'blue', 'green']);
            const s = await page.evaluate(() => {
                const p = pointAt(chain[1].t);
                return { hit: hitTest(p.x, p.y), miss: hitTest(-500, -500) };
            });
            expect(s.hit).toBe(1);
            expect(s.miss).toBe(-1);
        });

        test('inserting grows the chain and preserves spacing', async ({ page }) => {
            await seedChain(page, ['red', 'blue', 'green']);
            const s = await page.evaluate(() => {
                insertAt(1, 'yellow');
                return {
                    length: chain.length,
                    color: chain[1].color,
                    ordered: chain.every((m, i) => i === 0 || chain[i - 1].t - m.t >= SPACING - 0.01),
                };
            });
            expect(s.length).toBe(4);
            expect(s.color).toBe('yellow');
            expect(s.ordered).toBe(true);
        });

        test('inserting pushes the marbles behind it back', async ({ page }) => {
            await seedChain(page, ['red', 'blue', 'green']);
            const s = await page.evaluate(() => {
                const tailBefore = chain[2].t;
                insertAt(1, 'yellow');
                return { tailBefore, tailAfter: chain[3].t, spacing: SPACING };
            });
            expect(s.tailAfter).toBeCloseTo(s.tailBefore - s.spacing, 5);
        });

        test('inserting at the end appends to the tail', async ({ page }) => {
            await seedChain(page, ['red', 'blue']);
            const s = await page.evaluate(() => {
                insertAt(2, 'green');
                return { length: chain.length, last: chain[chain.length - 1].color };
            });
            expect(s.length).toBe(3);
            expect(s.last).toBe('green');
        });

        test('marbles pushed behind the start wait in the tunnel', async ({ page }) => {
            const s = await page.evaluate(() => {
                startGame();
                pending = 0;
                chain.length = 0;
                chain.push({ t: SPACING, color: 'red' });
                chain.push({ t: 0, color: 'blue' });
                insertAt(1, 'green');
                return {
                    tail: chain[chain.length - 1].t,
                    tunnelled: chain.filter(inTunnel).length,
                    ordered: chain.every((m, i) => i === 0 || chain[i - 1].t - m.t >= SPACING - 0.01),
                };
            });
            expect(s.tail).toBeLessThan(0);
            expect(s.tunnelled).toBe(1);
            expect(s.ordered).toBe(true);
        });

        test('marbles still in the tunnel cannot be shot', async ({ page }) => {
            const s = await page.evaluate(() => {
                startGame();
                pending = 0;
                chain.length = 0;
                chain.push({ t: -SPACING, color: 'red' });
                const p = pointAt(0);
                return { hit: hitTest(p.x, p.y) };
            });
            expect(s.hit).toBe(-1);
        });

        test('a fired marble that reaches the chain is inserted into it', async ({ page }) => {
            const s = await page.evaluate(() => {
                startGame();
                pending = 0;
                projectiles.length = 0;
                chain.length = 0;
                // A short chain of alternating colours so the shot cannot pop.
                for (let i = 0; i < 6; i++) {
                    chain.push({ t: 400 - i * SPACING, color: i % 2 ? 'red' : 'blue' });
                }
                const target = pointAt(chain[3].t);
                shooter.current = 'yellow';
                aimAt(target.x, target.y);
                shoot();
                const before = chain.length;
                for (let i = 0; i < 200; i++) step(0.016);
                return { before, after: chain.length, shots: projectiles.length, hasYellow: chain.some((m) => m.color === 'yellow') };
            });
            expect(s.after).toBe(s.before + 1);
            expect(s.shots).toBe(0);
            expect(s.hasYellow).toBe(true);
        });
    });

    // -----------------------------------------------------------------------
    // Matching and scoring
    // -----------------------------------------------------------------------
    test.describe('matching', () => {
        test('three of a colour pop', async ({ page }) => {
            await seedChain(page, ['blue', 'red', 'red', 'green']);
            const s = await page.evaluate(() => {
                insertAt(2, 'red');
                const removed = resolveMatches(2);
                return { removed, length: chain.length, colors: chain.map((m) => m.color) };
            });
            expect(s.removed).toBe(3);
            expect(s.length).toBe(2);
            expect(s.colors).toEqual(['blue', 'green']);
        });

        test('two of a colour do not pop', async ({ page }) => {
            await seedChain(page, ['blue', 'red', 'green']);
            const s = await page.evaluate(() => {
                insertAt(2, 'red');
                return { removed: resolveMatches(2), length: chain.length };
            });
            expect(s.removed).toBe(0);
            expect(s.length).toBe(4);
        });

        test('a longer run pops entirely', async ({ page }) => {
            await seedChain(page, ['green', 'red', 'red', 'red', 'red', 'green']);
            const s = await page.evaluate(() => ({ removed: resolveMatches(3), length: chain.length }));
            expect(s.removed).toBe(4);
            expect(s.length).toBe(2);
        });

        test('popping scores ten points per marble', async ({ page }) => {
            await seedChain(page, ['red', 'red', 'red']);
            const s = await page.evaluate(() => {
                score = 0;
                comboStep = 1;
                resolveMatches(1);
                return score;
            });
            expect(s).toBe(30);
        });

        test('a cascade in the same shot scores a rising multiplier', async ({ page }) => {
            const s = await page.evaluate(() => {
                startGame();
                pending = 0;
                chain.length = 0;
                score = 0;
                comboStep = 1;
                chain.push({ t: 300, color: 'red' });
                chain.push({ t: 300 - SPACING, color: 'red' });
                chain.push({ t: 300 - 2 * SPACING, color: 'red' });
                const first = resolveMatches(1);
                const afterFirst = score;
                chain.length = 0;
                chain.push({ t: 300, color: 'blue' });
                chain.push({ t: 300 - SPACING, color: 'blue' });
                chain.push({ t: 300 - 2 * SPACING, color: 'blue' });
                const second = resolveMatches(1);
                return { first, second, afterFirst, total: score };
            });
            expect(s.first).toBe(3);
            expect(s.second).toBe(3);
            expect(s.afterFirst).toBe(30);
            expect(s.total).toBe(30 + 60);
        });

        test('the combo resets on the next shot', async ({ page }) => {
            const s = await page.evaluate(() => {
                startGame();
                comboStep = 5;
                shoot();
                return comboStep;
            });
            expect(s).toBe(1);
        });

        test('closing a gap can trigger a follow-up pop', async ({ page }) => {
            const s = await page.evaluate(() => {
                startGame();
                pending = 0;
                score = 0;
                chain.length = 0;
                projectiles.length = 0;
                // Two reds up front, then a gap, then a red rolling in behind:
                // when the gap closes the three reds should pop.
                chain.push({ t: 320, color: 'red' });
                chain.push({ t: 320 - SPACING, color: 'red' });
                chain.push({ t: 320 - SPACING - 90, color: 'red' });
                chain.push({ t: 320 - 2 * SPACING - 90, color: 'blue' });
                for (let i = 0; i < 300; i++) step(0.016);
                return { length: chain.length, colors: chain.map((m) => m.color), score };
            });
            expect(s.length).toBe(1);
            expect(s.colors).toEqual(['blue']);
            expect(s.score).toBeGreaterThan(0);
        });

        test('a shot that completes a run pops it end to end', async ({ page }) => {
            const s = await page.evaluate(() => {
                startGame();
                pending = 0;
                score = 0;
                projectiles.length = 0;
                chain.length = 0;
                // Reds at the head, blues behind: wherever the shot lands near
                // the front it completes the run of three.
                chain.push({ t: 400, color: 'red' });
                chain.push({ t: 400 - SPACING, color: 'red' });
                for (let i = 2; i < 6; i++) chain.push({ t: 400 - i * SPACING, color: 'blue' });
                const target = pointAt(chain[0].t);
                shooter.current = 'red';
                aimAt(target.x, target.y);
                shoot();
                for (let i = 0; i < 200; i++) step(0.016);
                return { colors: chain.map((m) => m.color), score };
            });
            expect(s.colors.filter((c) => c === 'red').length).toBe(0);
            expect(s.colors.length).toBe(4);
            expect(s.score).toBeGreaterThanOrEqual(30);
        });
    });

    // -----------------------------------------------------------------------
    // Level flow and game over
    // -----------------------------------------------------------------------
    test.describe('level flow', () => {
        test('clearing every marble advances the level', async ({ page }) => {
            const s = await page.evaluate(() => {
                startGame();
                pending = 0;
                chain.length = 0;
                projectiles.length = 0;
                const before = level;
                step(0.016);
                return { before, after: level, state, pending, chain: chain.length };
            });
            expect(s.after).toBe(s.before + 1);
            expect(s.state).toBe('running');
            expect(s.pending).toBeGreaterThan(0);
        });

        test('the level counter is shown in the HUD', async ({ page }) => {
            await page.evaluate(() => {
                startGame();
                startLevel(4);
            });
            await expect(page.locator('#level')).toHaveText('4');
        });

        test('the marbles-left readout counts queued plus on-track marbles', async ({ page }) => {
            await page.evaluate(() => {
                startGame();
                pending = 7;
                chain.length = 0;
                chain.push({ t: 100, color: 'red' });
                chain.push({ t: 60, color: 'blue' });
                updateHud();
            });
            await expect(page.locator('#marbles')).toHaveText('9');
        });

        test('the game ends when the chain reaches the pit', async ({ page }) => {
            const s = await page.evaluate(() => {
                startGame();
                pending = 0;
                chain.length = 0;
                chain.push({ t: pathLength() - 2, color: 'red' });
                for (let i = 0; i < 120; i++) step(0.016);
                return state;
            });
            expect(s).toBe('over');
            await expect(page.locator('#overlay')).toHaveClass(/visible/);
            await expect(page.locator('#overlay-title')).toContainText(/over/i);
        });

        test('the best score is kept in localStorage', async ({ page }) => {
            const stored = await page.evaluate(() => {
                startGame();
                score = 1234;
                endGame();
                return window.localStorage.getItem('marble-loop-best');
            });
            expect(stored).toBe('1234');
            await expect(page.locator('#best')).toHaveText('1234');
        });

        test('a lower score does not overwrite the best', async ({ page }) => {
            await page.evaluate(() => window.localStorage.setItem('marble-loop-best', '9000'));
            await page.reload();
            const stored = await page.evaluate(() => {
                startGame();
                score = 12;
                endGame();
                return window.localStorage.getItem('marble-loop-best');
            });
            expect(stored).toBe('9000');
        });

        test('Space restarts after a game over', async ({ page }) => {
            await page.evaluate(() => {
                startGame();
                endGame();
            });
            await page.keyboard.press('Space');
            const s = await page.evaluate(() => ({ state, level, score }));
            expect(s.state).toBe('running');
            expect(s.level).toBe(1);
            expect(s.score).toBe(0);
        });

        test('shooting is ignored once the game is over', async ({ page }) => {
            const n = await page.evaluate(() => {
                startGame();
                endGame();
                shoot();
                return projectiles.length;
            });
            expect(n).toBe(0);
        });
    });

    // -----------------------------------------------------------------------
    // Pause and restart
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

        test('the chain is frozen while paused', async ({ page }) => {
            await seedChain(page, ['red', 'blue']);
            const s = await page.evaluate(() => {
                togglePause();
                const before = chain[0].t;
                for (let i = 0; i < 60; i++) step(0.016);
                return { before, after: chain[0].t };
            });
            expect(s.after).toBe(s.before);
        });

        test('R restarts the run', async ({ page }) => {
            await page.evaluate(() => {
                startGame();
                score = 500;
                startLevel(6);
            });
            await page.keyboard.press('r');
            const s = await page.evaluate(() => ({ state, level, score }));
            expect(s.state).toBe('running');
            expect(s.level).toBe(1);
            expect(s.score).toBe(0);
        });
    });

    // -----------------------------------------------------------------------
    // Rendering and HUD
    // -----------------------------------------------------------------------
    test.describe('rendering', () => {
        test('the HUD tracks the score', async ({ page }) => {
            await page.evaluate(() => {
                startGame();
                score = 250;
                updateHud();
            });
            await expect(page.locator('#score')).toHaveText('250');
        });

        test('drawing a populated board does not throw', async ({ page }) => {
            const errors = [];
            page.on('pageerror', (e) => errors.push(e.message));
            await seedChain(page, ['red', 'blue', 'green', 'yellow', 'purple']);
            await page.evaluate(() => {
                shoot();
                for (let i = 0; i < 30; i++) step(0.016);
                draw();
            });
            expect(errors).toEqual([]);
        });

        test('the canvas actually paints something', async ({ page }) => {
            const painted = await page.evaluate(() => {
                startGame();
                draw();
                const data = ctx.getImageData(0, 0, CANVAS_W, CANVAS_H).data;
                for (let i = 0; i < data.length; i += 4) {
                    if (data[i] || data[i + 1] || data[i + 2]) return true;
                }
                return false;
            });
            expect(painted).toBe(true);
        });

        test('a long run of frames stays consistent', async ({ page }) => {
            const errors = [];
            page.on('pageerror', (e) => errors.push(e.message));
            const ok = await page.evaluate(() => {
                startGame();
                for (let i = 0; i < 1200; i++) {
                    step(0.016);
                    if (state !== 'running') break;
                    for (let j = 1; j < chain.length; j++) {
                        if (chain[j - 1].t - chain[j].t < SPACING - 0.05) return false;
                    }
                }
                return true;
            });
            expect(ok).toBe(true);
            expect(errors).toEqual([]);
        });
    });
});
