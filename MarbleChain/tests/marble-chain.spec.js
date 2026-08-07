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

        test('score, level and best are shown', async ({ page }) => {
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

        test('no marbles in the chain before starting', async ({ page }) => {
            expect(await page.evaluate(() => chain.length)).toBe(0);
        });

        test('best score loads from localStorage', async ({ page }) => {
            await page.evaluate(() => window.localStorage.setItem('marble-chain-best', '4210'));
            await page.reload();
            await expect(page.locator('#best')).toHaveText('4210');
        });
    });

    // -----------------------------------------------------------------------
    // The path the chain crawls along
    // -----------------------------------------------------------------------
    test.describe('path', () => {
        test('path has a positive length', async ({ page }) => {
            expect(await page.evaluate(() => pathLength)).toBeGreaterThan(1000);
        });

        test('pathPoint clamps below 0 and above pathLength', async ({ page }) => {
            const same = await page.evaluate(() => {
                const a = pathPoint(-50), b = pathPoint(0);
                const c = pathPoint(pathLength + 50), d = pathPoint(pathLength);
                return { a, b, c, d };
            });
            expect(same.a).toEqual(same.b);
            expect(same.c).toEqual(same.d);
        });

        test('path ends at the hole', async ({ page }) => {
            const d = await page.evaluate(() => {
                const end = pathPoint(pathLength);
                return Math.hypot(end.x - hole.x, end.y - hole.y);
            });
            expect(d).toBeLessThan(1);
        });

        test('the path stays inside the canvas', async ({ page }) => {
            const inside = await page.evaluate(() => {
                for (let d = 0; d <= pathLength; d += 10) {
                    const p = pathPoint(d);
                    if (p.x < 0 || p.x > CANVAS_W || p.y < 0 || p.y > CANVAS_H) return false;
                }
                return true;
            });
            expect(inside).toBe(true);
        });

        test('marbles sit one spacing apart along the path', async ({ page }) => {
            const r = await page.evaluate(() => {
                startGame();
                setChain(['red', 'blue', 'green'], 600);
                return { d0: marbleDist(0), d1: marbleDist(1), d2: marbleDist(2), p0: marblePos(0), q0: pathPoint(600) };
            });
            expect(r.d0).toBe(600);
            expect(r.d1).toBe(600 - (await page.evaluate(() => SPACING)));
            expect(r.d2).toBeLessThan(r.d1);
            expect(r.p0).toEqual(r.q0);
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

        test('game starts on level 1 with no score', async ({ page }) => {
            const s = await page.evaluate(() => { startGame(); return { level, score, state }; });
            expect(s.level).toBe(1);
            expect(s.score).toBe(0);
            expect(s.state).toBe('running');
        });

        test('the first marble is fed onto the path immediately', async ({ page }) => {
            const s = await page.evaluate(() => { startGame(); return { n: chain.length, head: headDist, left: remaining }; });
            expect(s.n).toBe(1);
            expect(s.head).toBe(0);
            expect(s.left).toBe((await page.evaluate(() => LEVEL_SUPPLY)) - 1);
        });

        test('the shooter is loaded with a current and next marble', async ({ page }) => {
            const s = await page.evaluate(() => {
                startGame();
                return { cur: shooter.current, next: shooter.next, palette: levelColors(1) };
            });
            expect(s.palette).toContain(s.cur);
            expect(s.palette).toContain(s.next);
        });

        test('later levels use more colors', async ({ page }) => {
            const r = await page.evaluate(() => ({
                sizes: [1, 2, 3, 8].map((l) => levelColors(l).length),
                total: COLORS.length,
            }));
            expect(r.sizes[0]).toBeGreaterThanOrEqual(3);
            expect(r.sizes[1]).toBeGreaterThanOrEqual(r.sizes[0]);
            expect(r.sizes[2]).toBeGreaterThan(r.sizes[0]);
            expect(r.sizes[3]).toBe(r.total);
        });

        test('the chain moves faster on later levels', async ({ page }) => {
            const speeds = await page.evaluate(() => [chainSpeed(1), chainSpeed(2), chainSpeed(5)]);
            expect(speeds[1]).toBeGreaterThan(speeds[0]);
            expect(speeds[2]).toBeGreaterThan(speeds[1]);
        });
    });

    // -----------------------------------------------------------------------
    // The crawling chain
    // -----------------------------------------------------------------------
    test.describe('chain movement', () => {
        test('the chain advances along the path over time', async ({ page }) => {
            const r = await page.evaluate(() => {
                startGame();
                const before = headDist;
                step(1);
                return { before, after: headDist, expected: chainSpeed(1) };
            });
            expect(r.after).toBeCloseTo(r.before + r.expected, 3);
        });

        test('new marbles feed in as room appears behind the chain', async ({ page }) => {
            const r = await page.evaluate(() => {
                startGame();
                const n0 = chain.length;
                for (let i = 0; i < 200; i++) step(1 / 60);
                return { n0, n1: chain.length, left: remaining };
            });
            expect(r.n1).toBeGreaterThan(r.n0);
            expect(r.left).toBeLessThan(20 * 60);
        });

        test('no more marbles feed in once the supply is exhausted', async ({ page }) => {
            const r = await page.evaluate(() => {
                startGame();
                remaining = 0;
                const n0 = chain.length;
                for (let i = 0; i < 120; i++) step(1 / 60);
                return { n0, n1: chain.length };
            });
            expect(r.n1).toBe(r.n0);
        });

        test('the game ends when the head reaches the hole', async ({ page }) => {
            const s = await page.evaluate(() => {
                startGame();
                setChain(['red', 'blue'], pathLength - 1);
                step(1);
                return state;
            });
            expect(s).toBe('over');
        });

        test('the chain is frozen while paused', async ({ page }) => {
            const r = await page.evaluate(() => {
                startGame();
                togglePause();
                const before = headDist;
                step(1);
                return { state, before, after: headDist };
            });
            expect(r.state).toBe('paused');
            expect(r.after).toBe(r.before);
        });

        test('P resumes a paused game', async ({ page }) => {
            await page.keyboard.press('Space');
            await page.keyboard.press('KeyP');
            expect(await page.evaluate(() => state)).toBe('paused');
            await page.keyboard.press('KeyP');
            expect(await page.evaluate(() => state)).toBe('running');
        });
    });

    // -----------------------------------------------------------------------
    // Aiming and shooting
    // -----------------------------------------------------------------------
    test.describe('shooting', () => {
        test('aiming at a point points the shooter at it', async ({ page }) => {
            const a = await page.evaluate(() => {
                startGame();
                aimAt(shooter.x + 100, shooter.y);
                return shooter.angle;
            });
            expect(Math.abs(a)).toBeLessThan(1e-6);
        });

        test('holding an arrow key rotates the aim', async ({ page }) => {
            const r = await page.evaluate(() => {
                startGame();
                setAim(0);
                heldKeys.add('ArrowLeft');
                step(0.5);
                const left = shooter.angle;
                heldKeys.clear();
                heldKeys.add('ArrowRight');
                step(0.5);
                return { left, right: shooter.angle };
            });
            expect(r.left).toBeLessThan(0);
            expect(r.right).toBeGreaterThan(r.left);
        });

        test('firing launches a marble along the aim', async ({ page }) => {
            const r = await page.evaluate(() => {
                startGame();
                setAim(0);
                const color = shooter.current;
                fire();
                return { n: shots.length, shot: shots[0], color };
            });
            expect(r.n).toBe(1);
            expect(r.shot.color).toBe(r.color);
            expect(r.shot.vx).toBeGreaterThan(0);
            expect(Math.abs(r.shot.vy)).toBeLessThan(1e-6);
        });

        test('firing promotes the next marble into the barrel', async ({ page }) => {
            const r = await page.evaluate(() => {
                startGame();
                const next = shooter.next;
                fire();
                return { current: shooter.current, wasNext: next, newNext: shooter.next };
            });
            expect(r.current).toBe(r.wasNext);
            expect(r.newNext).toBeTruthy();
        });

        test('Space fires once the game is running', async ({ page }) => {
            await page.keyboard.press('Space');
            await page.evaluate(() => { shots.length = 0; });
            await page.keyboard.press('Space');
            expect(await page.evaluate(() => shots.length)).toBe(1);
        });

        test('clicking the canvas fires at the pointer', async ({ page }) => {
            await page.evaluate(() => { startGame(); shots.length = 0; });
            await page.locator('#canvas').click({ position: { x: 700, y: 260 } });
            expect(await page.evaluate(() => shots.length)).toBe(1);
        });

        test('swapping exchanges the current and next marbles', async ({ page }) => {
            const r = await page.evaluate(() => {
                startGame();
                shooter.current = 'red';
                shooter.next = 'blue';
                swapMarbles();
                return { current: shooter.current, next: shooter.next };
            });
            expect(r.current).toBe('blue');
            expect(r.next).toBe('red');
        });

        test('a shot flies and is discarded when it leaves the canvas', async ({ page }) => {
            const r = await page.evaluate(() => {
                startGame();
                chain.length = 0;
                setAim(-Math.PI / 2);
                fire();
                const y0 = shots[0].y;
                step(0.05);
                const moved = shots[0].y < y0;
                for (let i = 0; i < 120; i++) step(1 / 60);
                return { moved, n: shots.length };
            });
            expect(r.moved).toBe(true);
            expect(r.n).toBe(0);
        });

        test('no more than the shot limit can be in flight', async ({ page }) => {
            const n = await page.evaluate(() => {
                startGame();
                chain.length = 0;
                for (let i = 0; i < 10; i++) fire();
                return shots.length;
            });
            expect(n).toBeLessThanOrEqual(3);
        });

        test('firing does nothing while paused', async ({ page }) => {
            const n = await page.evaluate(() => {
                startGame();
                togglePause();
                shots.length = 0;
                fire();
                return shots.length;
            });
            expect(n).toBe(0);
        });
    });

    // -----------------------------------------------------------------------
    // Inserting marbles and matching
    // -----------------------------------------------------------------------
    test.describe('insertion and matching', () => {
        test('a shot that reaches the chain is inserted into it', async ({ page }) => {
            const r = await page.evaluate(() => {
                startGame();
                setChain(['red', 'blue', 'green', 'yellow'], 900);
                const target = marblePos(1);
                shots.length = 0;
                shots.push({ x: target.x, y: target.y - 1, vx: 0, vy: 40, color: 'purple' });
                step(1 / 60);
                return { n: chain.length, colors: chain.map((m) => m.color), shots: shots.length };
            });
            expect(r.n).toBe(5);
            expect(r.colors).toContain('purple');
            expect(r.shots).toBe(0);
        });

        test('inserting pushes the marbles behind it further back', async ({ page }) => {
            const r = await page.evaluate(() => {
                startGame();
                setChain(['red', 'blue', 'green'], 900);
                const tailBefore = marbleDist(2);
                insertAt(1, 'purple');
                return { tailBefore, tailAfter: marbleDist(3), head: marbleDist(0), spacing: SPACING };
            });
            expect(r.head).toBe(900);
            expect(r.tailAfter).toBeCloseTo(r.tailBefore - r.spacing, 6);
        });

        test('two of a colour do not clear', async ({ page }) => {
            const r = await page.evaluate(() => {
                startGame();
                setChain(['red', 'blue', 'green'], 900);
                insertAt(1, 'red');
                const cleared = resolveMatches(1);
                return { cleared, n: chain.length, score };
            });
            expect(r.cleared).toBe(0);
            expect(r.n).toBe(4);
            expect(r.score).toBe(0);
        });

        test('three of a colour clear and score', async ({ page }) => {
            const r = await page.evaluate(() => {
                startGame();
                setChain(['blue', 'red', 'red', 'green'], 900);
                insertAt(1, 'red');
                const cleared = resolveMatches(1);
                return { cleared, colors: chain.map((m) => m.color), score };
            });
            expect(r.cleared).toBe(3);
            expect(r.colors).toEqual(['blue', 'green']);
            expect(r.score).toBeGreaterThan(0);
        });

        test('longer runs clear entirely and score more', async ({ page }) => {
            const three = await page.evaluate(() => {
                startGame();
                setChain(['red', 'red'], 900);
                insertAt(0, 'red');
                resolveMatches(0);
                return score;
            });
            const five = await page.evaluate(() => {
                startGame();
                setChain(['red', 'red', 'red', 'red'], 900);
                insertAt(0, 'red');
                const cleared = resolveMatches(0);
                return { score, cleared, n: chain.length };
            });
            expect(five.cleared).toBe(5);
            expect(five.n).toBe(0);
            expect(five.score).toBeGreaterThan(three);
        });

        test('the head of the chain can be shot in front of', async ({ page }) => {
            const r = await page.evaluate(() => {
                startGame();
                setChain(['red', 'blue'], 900);
                insertAt(0, 'green');
                return { colors: chain.map((m) => m.color), head: marbleDist(0) };
            });
            expect(r.colors).toEqual(['green', 'red', 'blue']);
            expect(r.head).toBe(900);
        });

        test('closing a gap can trigger a combo', async ({ page }) => {
            const r = await page.evaluate(() => {
                startGame();
                // blue blue [red red] blue  ->  inserting a red clears the reds,
                // the blues snap together and clear as a combo.
                setChain(['blue', 'blue', 'red', 'red', 'blue'], 900);
                insertAt(2, 'red');
                const cleared = resolveMatches(2);
                return { cleared, n: chain.length, combo: lastCombo, score };
            });
            expect(r.cleared).toBe(6);
            expect(r.n).toBe(0);
            expect(r.combo).toBe(2);
            expect(r.score).toBeGreaterThan(0);
        });

        test('a shot is inserted on the side it arrives from', async ({ page }) => {
            const r = await page.evaluate(() => {
                startGame();
                setChain(['red', 'blue', 'green', 'yellow', 'orange'], 900);
                const ahead = pathPoint(marbleDist(2) + SPACING * 0.45);
                shots.length = 0;
                shots.push({ x: ahead.x, y: ahead.y, vx: 0, vy: 0, color: 'purple' });
                step(1 / 60);
                return chain.map((m) => m.color);
            });
            expect(r.indexOf('purple')).toBeLessThanOrEqual(2);
            expect(r.indexOf('purple')).toBeGreaterThan(0);
        });

        test('shots only insert into the chain, never pass through it', async ({ page }) => {
            const r = await page.evaluate(() => {
                startGame();
                setChain(['red', 'blue', 'green', 'yellow', 'orange', 'purple'], 900);
                const target = marblePos(3);
                const dx = target.x - shooter.x, dy = target.y - shooter.y;
                setAim(Math.atan2(dy, dx));
                shots.length = 0;
                fire();
                for (let i = 0; i < 120 && shots.length; i++) step(1 / 60);
                return { shots: shots.length, n: chain.length };
            });
            expect(r.shots).toBe(0);
            expect(r.n).toBe(7);
        });
    });

    // -----------------------------------------------------------------------
    // Level flow and game over
    // -----------------------------------------------------------------------
    test.describe('levels and game over', () => {
        test('clearing the last marbles completes the level', async ({ page }) => {
            const r = await page.evaluate(() => {
                startGame();
                remaining = 0;
                setChain(['red', 'red'], 900);
                insertAt(0, 'red');
                resolveMatches(0);
                step(1 / 60);
                return { state, level };
            });
            expect(r.state).toBe('cleared');
            expect(r.level).toBe(1);
        });

        test('continuing from a cleared level advances to the next one', async ({ page }) => {
            const r = await page.evaluate(() => {
                startGame();
                remaining = 0;
                chain.length = 0;
                step(1 / 60);
                const cleared = state;
                startGame();
                return { cleared, level, state, left: remaining, n: chain.length };
            });
            expect(r.cleared).toBe('cleared');
            expect(r.level).toBe(2);
            expect(r.state).toBe('running');
            expect(r.n).toBe(1);
        });

        test('score carries across levels', async ({ page }) => {
            const r = await page.evaluate(() => {
                startGame();
                score = 500;
                remaining = 0;
                chain.length = 0;
                step(1 / 60);
                startGame();
                return score;
            });
            expect(r).toBe(500);
        });

        test('game over shows the overlay with the final score', async ({ page }) => {
            await page.evaluate(() => {
                startGame();
                score = 1234;
                setChain(['red'], pathLength);
                step(1 / 60);
            });
            await expect(page.locator('#overlay')).toHaveClass(/visible/);
            await expect(page.locator('#overlay-title')).toContainText(/over/i);
            await expect(page.locator('#overlay-score')).toContainText('1234');
        });

        test('game over records a new best score', async ({ page }) => {
            const stored = await page.evaluate(() => {
                startGame();
                score = 777;
                setChain(['red'], pathLength);
                step(1 / 60);
                return window.localStorage.getItem('marble-chain-best');
            });
            expect(stored).toBe('777');
            await expect(page.locator('#best')).toHaveText('777');
        });

        test('a lower score does not overwrite the best', async ({ page }) => {
            const stored = await page.evaluate(() => {
                window.localStorage.setItem('marble-chain-best', '5000');
                best = 5000;
                startGame();
                score = 10;
                setChain(['red'], pathLength);
                step(1 / 60);
                return window.localStorage.getItem('marble-chain-best');
            });
            expect(stored).toBe('5000');
        });

        test('restarting after game over resets score and level', async ({ page }) => {
            const r = await page.evaluate(() => {
                startGame();
                score = 900;
                level = 4;
                setChain(['red'], pathLength);
                step(1 / 60);
                startGame();
                return { state, score, level };
            });
            expect(r.state).toBe('running');
            expect(r.score).toBe(0);
            expect(r.level).toBe(1);
        });

        test('the HUD tracks score, level and marbles left', async ({ page }) => {
            await page.evaluate(() => {
                startGame();
                score = 320;
                level = 3;
                remaining = 12;
                updateHud();
            });
            await expect(page.locator('#score')).toHaveText('320');
            await expect(page.locator('#level')).toHaveText('3');
            await expect(page.locator('#left')).toHaveText('12');
        });
    });

    // -----------------------------------------------------------------------
    // Rendering
    // -----------------------------------------------------------------------
    test.describe('rendering', () => {
        test('the canvas is painted', async ({ page }) => {
            const painted = await page.evaluate(() => {
                startGame();
                setChain(['red', 'blue', 'green'], 900);
                draw();
                const d = ctx.getImageData(0, 0, CANVAS_W, CANVAS_H).data;
                for (let i = 3; i < d.length; i += 4) if (d[i] !== 0) return true;
                return false;
            });
            expect(painted).toBe(true);
        });

        test('the animation loop runs without errors', async ({ page }) => {
            const errors = [];
            page.on('pageerror', (e) => errors.push(e.message));
            await page.evaluate(() => startGame());
            await page.waitForTimeout(400);
            expect(errors).toEqual([]);
            expect(await page.evaluate(() => headDist)).toBeGreaterThan(0);
        });
    });
});
