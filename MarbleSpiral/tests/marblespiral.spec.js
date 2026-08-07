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

        test('score and best start at 0', async ({ page }) => {
            await expect(page.locator('#score')).toHaveText('0');
            await expect(page.locator('#best')).toHaveText('0');
        });

        test('level starts at 1', async ({ page }) => {
            await expect(page.locator('#level')).toHaveText('1');
        });

        test('canvas is 640x480', async ({ page }) => {
            const canvas = page.locator('#canvas');
            await expect(canvas).toHaveAttribute('width', '640');
            await expect(canvas).toHaveAttribute('height', '480');
        });

        test('state is idle before starting', async ({ page }) => {
            expect(await page.evaluate(() => state)).toBe('idle');
        });

        test('the chain is empty before starting', async ({ page }) => {
            expect(await page.evaluate(() => chain.length)).toBe(0);
        });

        test('best score loads from localStorage', async ({ page }) => {
            await page.evaluate(() => window.localStorage.setItem('marble-spiral-best', '4210'));
            await page.reload();
            await expect(page.locator('#best')).toHaveText('4210');
        });
    });

    // -----------------------------------------------------------------------
    // The spiral path
    // -----------------------------------------------------------------------
    test.describe('path', () => {
        test('the path has a positive length', async ({ page }) => {
            expect(await page.evaluate(() => pathLength())).toBeGreaterThan(500);
        });

        test('the path is arc-length parameterised', async ({ page }) => {
            // Stepping 10 units along the path should move ~10px in space.
            const gaps = await page.evaluate(() => {
                const out = [];
                for (let d = 0; d < pathLength() - 10; d += 97) {
                    const a = pathPoint(d), b = pathPoint(d + 10);
                    out.push(Math.hypot(b.x - a.x, b.y - a.y));
                }
                return out;
            });
            expect(gaps.length).toBeGreaterThan(3);
            for (const g of gaps) {
                expect(g).toBeGreaterThan(5);
                expect(g).toBeLessThan(12);
            }
        });

        test('the path stays inside the canvas', async ({ page }) => {
            const ok = await page.evaluate(() => {
                for (let d = 0; d <= pathLength(); d += 5) {
                    const p = pathPoint(d);
                    if (p.x < 0 || p.x > CANVAS_W || p.y < 0 || p.y > CANVAS_H) return false;
                }
                return true;
            });
            expect(ok).toBe(true);
        });

        test('path distances are clamped to the ends', async ({ page }) => {
            const same = await page.evaluate(() => {
                const a = pathPoint(-500), start = pathPoint(0);
                const b = pathPoint(pathLength() + 500), end = pathPoint(pathLength());
                return {
                    startMatch: Math.hypot(a.x - start.x, a.y - start.y) < 0.001,
                    endMatch: Math.hypot(b.x - end.x, b.y - end.y) < 0.001,
                };
            });
            expect(same.startMatch).toBe(true);
            expect(same.endMatch).toBe(true);
        });

        test('the path ends at the pit', async ({ page }) => {
            const d = await page.evaluate(() => {
                const p = pathPoint(pathLength());
                return Math.hypot(p.x - PIT.x, p.y - PIT.y);
            });
            expect(d).toBeLessThan(1);
        });

        test('nearestPathDist finds the distance of a point on the path', async ({ page }) => {
            const err = await page.evaluate(() => {
                const target = pathLength() * 0.4;
                const p = pathPoint(target);
                return Math.abs(nearestPathDist(p.x, p.y) - target);
            });
            expect(err).toBeLessThan(6);
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
            expect(s.level).toBe(1);
            expect(s.score).toBe(0);
            expect(s.state).toBe('running');
        });

        test('a new game queues the level ball count', async ({ page }) => {
            const s = await page.evaluate(() => {
                startGame();
                return { pending, expected: levelBallCount(1), chain: chain.length };
            });
            // The first marble enters the path immediately.
            expect(s.pending + s.chain).toBe(s.expected);
        });

        test('the shooter is loaded with a current and next colour', async ({ page }) => {
            const s = await page.evaluate(() => {
                startGame();
                return { cur: currentColor, next: nextColor, palette: COLORS };
            });
            expect(s.palette).toContain(s.cur);
            expect(s.palette).toContain(s.next);
        });

        test('no shots are in flight at the start', async ({ page }) => {
            expect(await page.evaluate(() => { startGame(); return shots.length; })).toBe(0);
        });
    });

    // -----------------------------------------------------------------------
    // The advancing chain
    // -----------------------------------------------------------------------
    test.describe('chain', () => {
        test('the chain advances along the path over time', async ({ page }) => {
            const { before, after } = await page.evaluate(() => {
                startGame();
                const before = chainFront;
                for (let i = 0; i < 60; i++) step(0.016);
                return { before, after: chainFront };
            });
            expect(after).toBeGreaterThan(before);
        });

        test('marbles are spaced evenly behind the leader', async ({ page }) => {
            const gaps = await page.evaluate(() => {
                startGame();
                for (let i = 0; i < 600; i++) step(0.016);
                const out = [];
                for (let i = 1; i < Math.min(5, chain.length); i++) {
                    out.push(ballDist(i - 1) - ballDist(i));
                }
                return out;
            });
            expect(gaps.length).toBeGreaterThan(2);
            for (const g of gaps) expect(g).toBeCloseTo(24, 5);
        });

        test('marbles feed onto the path as the chain moves', async ({ page }) => {
            const { early, late } = await page.evaluate(() => {
                startGame();
                for (let i = 0; i < 30; i++) step(0.016);
                const early = chain.length;
                for (let i = 0; i < 600; i++) step(0.016);
                return { early, late: chain.length };
            });
            expect(late).toBeGreaterThan(early);
        });

        test('the queue drains as marbles enter the path', async ({ page }) => {
            const { before, after } = await page.evaluate(() => {
                startGame();
                const before = pending;
                for (let i = 0; i < 600; i++) step(0.016);
                return { before, after: pending };
            });
            expect(after).toBeLessThan(before);
        });

        test('no more marbles enter than the level provides', async ({ page }) => {
            const total = await page.evaluate(() => {
                startGame();
                for (let i = 0; i < 20000; i++) {
                    step(0.016);
                    if (state !== 'running') break;
                }
                return chain.length + pending;
            });
            expect(total).toBeLessThanOrEqual(await page.evaluate(() => levelBallCount(1)));
        });

        test('marbles use only the colours available at this level', async ({ page }) => {
            const ok = await page.evaluate(() => {
                startGame();
                for (let i = 0; i < 900; i++) step(0.016);
                const allowed = COLORS.slice(0, colorsForLevel(level));
                return chain.every((b) => allowed.includes(b.color));
            });
            expect(ok).toBe(true);
        });

        test('later levels use more colours, capped at the palette size', async ({ page }) => {
            const s = await page.evaluate(() => ({
                l1: colorsForLevel(1),
                l5: colorsForLevel(5),
                l99: colorsForLevel(99),
                palette: COLORS.length,
            }));
            expect(s.l1).toBeGreaterThanOrEqual(3);
            expect(s.l5).toBeGreaterThan(s.l1);
            expect(s.l99).toBe(s.palette);
        });

        test('later levels are longer and faster', async ({ page }) => {
            const s = await page.evaluate(() => ({
                count1: levelBallCount(1),
                count4: levelBallCount(4),
                speed1: chainSpeed(1),
                speed4: chainSpeed(4),
            }));
            expect(s.count4).toBeGreaterThan(s.count1);
            expect(s.speed4).toBeGreaterThan(s.speed1);
        });

        test('a level never queues more marbles than the groove holds', async ({ page }) => {
            const s = await page.evaluate(() => ({
                deep: levelBallCount(99),
                cap: COUNT_MAX,
                capacity: Math.floor(pathLength() / BALL_SPACING),
            }));
            expect(s.deep).toBe(s.cap);
            expect(s.cap).toBeLessThan(s.capacity);
        });
    });

    // -----------------------------------------------------------------------
    // Aiming & shooting
    // -----------------------------------------------------------------------
    test.describe('shooting', () => {
        test('aimAt points the shooter at the target', async ({ page }) => {
            const a = await page.evaluate(() => {
                startGame();
                aimAt(shooter.x + 100, shooter.y);
                return shooter.angle;
            });
            expect(Math.abs(a)).toBeLessThan(0.001);
        });

        test('shooting launches a marble of the current colour', async ({ page }) => {
            const s = await page.evaluate(() => {
                startGame();
                currentColor = COLORS[0];
                aimAt(shooter.x + 100, shooter.y);
                shoot();
                return { count: shots.length, color: shots[0] && shots[0].color };
            });
            expect(s.count).toBe(1);
            expect(s.color).toBe(await page.evaluate(() => COLORS[0]));
        });

        test('a shot travels in the aimed direction', async ({ page }) => {
            const s = await page.evaluate(() => {
                startGame();
                chain.length = 0;
                pending = 0;
                aimAt(shooter.x + 100, shooter.y);
                shoot();
                const x0 = shots[0].x, y0 = shots[0].y;
                step(0.05);
                return { dx: shots[0].x - x0, dy: shots[0].y - y0 };
            });
            expect(s.dx).toBeGreaterThan(0);
            expect(Math.abs(s.dy)).toBeLessThan(1);
        });

        test('the next marble is loaded after shooting', async ({ page }) => {
            const s = await page.evaluate(() => {
                startGame();
                const wasNext = nextColor;
                shoot();
                return { wasNext, cur: currentColor };
            });
            expect(s.cur).toBe(s.wasNext);
        });

        test('a cooldown stops rapid-fire double shots', async ({ page }) => {
            const n = await page.evaluate(() => {
                startGame();
                shoot();
                shoot();
                return shots.length;
            });
            expect(n).toBe(1);
        });

        test('shooting is possible again after the cooldown', async ({ page }) => {
            const n = await page.evaluate(() => {
                startGame();
                chain.length = 0;
                pending = 0;
                shoot();
                step(SHOT_COOLDOWN + 0.05);
                shoot();
                return shots.length;
            });
            expect(n).toBe(2);
        });

        test('swap exchanges the current and next marbles', async ({ page }) => {
            const s = await page.evaluate(() => {
                startGame();
                currentColor = COLORS[0];
                nextColor = COLORS[1];
                swapColors();
                return { cur: currentColor, next: nextColor };
            });
            expect(s.cur).toBe(await page.evaluate(() => COLORS[1]));
            expect(s.next).toBe(await page.evaluate(() => COLORS[0]));
        });

        test('shots that leave the canvas are removed', async ({ page }) => {
            const n = await page.evaluate(() => {
                startGame();
                chain.length = 0;
                pending = 0;
                aimAt(shooter.x + 100, shooter.y);
                shoot();
                for (let i = 0; i < 200; i++) step(0.016);
                return shots.length;
            });
            expect(n).toBe(0);
        });

        test('clicking the canvas fires a marble', async ({ page }) => {
            await page.evaluate(() => { startGame(); chain.length = 0; pending = 0; });
            await page.locator('#canvas').click({ position: { x: 20, y: 20 } });
            expect(await page.evaluate(() => shots.length)).toBe(1);
        });
    });

    // -----------------------------------------------------------------------
    // Insertion into the chain
    // -----------------------------------------------------------------------
    test.describe('insertion', () => {
        test('a shot that reaches the chain is inserted into it', async ({ page }) => {
            const s = await page.evaluate(() => {
                startGame();
                pending = 0;
                chainFront = pathLength() * 0.5;
                chain.length = 0;
                for (const c of [COLORS[0], COLORS[1], COLORS[2], COLORS[1]]) chain.push({ color: c });
                const p = ballPos(2);
                fireTestShot(COLORS[3], p.x, p.y);
                step(0.016);
                return { len: chain.length, shots: shots.length };
            });
            expect(s.len).toBe(5);
            expect(s.shots).toBe(0);
        });

        test('an inserted marble lands next to the marble it hit', async ({ page }) => {
            const idx = await page.evaluate(() => {
                startGame();
                pending = 0;
                chainFront = pathLength() * 0.5;
                chain.length = 0;
                for (const c of [COLORS[0], COLORS[0], COLORS[1], COLORS[0], COLORS[0]]) chain.push({ color: c });
                const p = ballPos(2);
                fireTestShot(COLORS[2], p.x, p.y);
                step(0.016);
                return chain.findIndex((b) => b.color === COLORS[2]);
            });
            // Inserted either just ahead of or just behind the marble it struck.
            expect([2, 3]).toContain(idx);
        });

        test('insertion pushes the tail back, not the leader forward', async ({ page }) => {
            const s = await page.evaluate(() => {
                startGame();
                pending = 0;
                chainFront = pathLength() * 0.5;
                chain.length = 0;
                for (const c of [COLORS[0], COLORS[1], COLORS[2], COLORS[1]]) chain.push({ color: c });
                const front = chainFront;
                const tail = ballDist(chain.length - 1);
                const p = ballPos(2);
                fireTestShot(COLORS[3], p.x, p.y);
                step(0.001);
                return { front, newFront: chainFront, tail, newTail: ballDist(chain.length - 1) };
            });
            expect(s.newFront).toBeCloseTo(s.front, 1);
            expect(s.newTail).toBeLessThan(s.tail);
        });

        test('a chain that fills the groove slides forward instead of hanging off the back', async ({ page }) => {
            const s = await page.evaluate(() => {
                startGame();
                pending = 0;
                chainFront = 200;          // only room for ~9 marbles behind the leader
                chain.length = 0;
                for (let i = 0; i < 9; i++) chain.push({ color: COLORS[i % 2] });
                const before = chainFront;
                const p = ballPos(4);
                fireTestShot(COLORS[2], p.x, p.y);
                step(0.001);
                return { before, after: chainFront, tail: ballDist(chain.length - 1), len: chain.length };
            });
            expect(s.len).toBe(10);
            expect(s.after).toBeGreaterThan(s.before);
            expect(s.tail).toBeGreaterThanOrEqual(0);
        });

        test('a shot passing through empty space does not join the chain', async ({ page }) => {
            const len = await page.evaluate(() => {
                startGame();
                pending = 0;
                chainFront = 60;   // chain is bunched near the path start
                chain.length = 0;
                chain.push({ color: COLORS[0] });
                fireTestShot(COLORS[1], PIT.x, PIT.y - 2); // far from the lone marble
                step(0.001);
                return chain.length;
            });
            expect(len).toBe(1);
        });
    });

    // -----------------------------------------------------------------------
    // Matching & scoring
    // -----------------------------------------------------------------------
    test.describe('matching', () => {
        test('three of a colour pop and leave the chain', async ({ page }) => {
            const s = await page.evaluate(() => {
                startGame();
                pending = 0;
                chainFront = pathLength() * 0.5;
                chain.length = 0;
                for (const c of [COLORS[1], COLORS[0], COLORS[0], COLORS[1]]) chain.push({ color: c });
                const p = ballPos(1);
                fireTestShot(COLORS[0], p.x, p.y);
                step(0.016);
                return { len: chain.length, colors: chain.map((b) => b.color) };
            });
            expect(s.len).toBe(2);
            expect(s.colors).toEqual(await page.evaluate(() => [COLORS[1], COLORS[1]]));
        });

        test('popping marbles scores points', async ({ page }) => {
            const score = await page.evaluate(() => {
                startGame();
                pending = 0;
                score = 0;
                chainFront = pathLength() * 0.5;
                chain.length = 0;
                for (const c of [COLORS[1], COLORS[0], COLORS[0], COLORS[1]]) chain.push({ color: c });
                const p = ballPos(1);
                fireTestShot(COLORS[0], p.x, p.y);
                step(0.016);
                return score;
            });
            expect(score).toBeGreaterThan(0);
        });

        test('two of a colour do not pop', async ({ page }) => {
            const len = await page.evaluate(() => {
                startGame();
                pending = 0;
                chainFront = pathLength() * 0.5;
                chain.length = 0;
                for (const c of [COLORS[1], COLORS[0], COLORS[2], COLORS[1]]) chain.push({ color: c });
                const p = ballPos(1);
                fireTestShot(COLORS[0], p.x, p.y);
                step(0.016);
                return chain.length;
            });
            expect(len).toBe(5);
        });

        test('a pop that joins two matching groups chain-reacts', async ({ page }) => {
            const s = await page.evaluate(() => {
                startGame();
                pending = 0;
                score = 0;
                chainFront = pathLength() * 0.5;
                chain.length = 0;
                // B R R G G R R B — inserting a third G pops the greens, which
                // joins the four reds into a run that pops straight after it.
                // The two blues on the ends survive, so the level does not end
                // and the cascade can be observed on its own.
                for (const c of [
                    COLORS[2],
                    COLORS[0], COLORS[0], COLORS[1], COLORS[1], COLORS[0], COLORS[0],
                    COLORS[2],
                ]) chain.push({ color: c });
                const p = ballPos(3);
                fireTestShot(COLORS[1], p.x, p.y);
                step(0.016);
                return { len: chain.length, colors: chain.map((b) => b.color), combo: lastCombo };
            });
            expect(s.len).toBe(2);
            expect(s.colors).toEqual(await page.evaluate(() => [COLORS[2], COLORS[2]]));
            expect(s.combo).toBe(2);
        });

        test('chain reactions are worth more than a plain pop', async ({ page }) => {
            const s = await page.evaluate(() => {
                function popScore(colors, hitIndex, shotColor) {
                    startGame();
                    pending = 0;
                    score = 0;
                    chainFront = pathLength() * 0.5;
                    chain.length = 0;
                    for (const c of colors) chain.push({ color: c });
                    const p = ballPos(hitIndex);
                    fireTestShot(shotColor, p.x, p.y);
                    step(0.016);
                    return score;
                }
                const plain = popScore(
                    [COLORS[2], COLORS[0], COLORS[0], COLORS[2], COLORS[1], COLORS[2]], 1, COLORS[0]);
                const combo = popScore(
                    [COLORS[2], COLORS[0], COLORS[0], COLORS[1], COLORS[1], COLORS[0], COLORS[0],
                        COLORS[2]], 3, COLORS[1]);
                return { plain, combo };
            });
            expect(s.combo).toBeGreaterThan(s.plain);
        });

        test('popping pushes the chain back from the pit', async ({ page }) => {
            const s = await page.evaluate(() => {
                startGame();
                pending = 0;
                chainFront = pathLength() * 0.5;
                chain.length = 0;
                for (const c of [COLORS[1], COLORS[0], COLORS[0], COLORS[1]]) chain.push({ color: c });
                const before = chainFront;
                const p = ballPos(1);
                fireTestShot(COLORS[0], p.x, p.y);
                step(0.016);
                return { before, after: chainFront };
            });
            expect(s.after).toBeLessThan(s.before);
        });
    });

    // -----------------------------------------------------------------------
    // Levels, losing and winning
    // -----------------------------------------------------------------------
    test.describe('levels', () => {
        test('clearing every marble advances to the next level', async ({ page }) => {
            const s = await page.evaluate(() => {
                startGame();
                pending = 0;
                chainFront = pathLength() * 0.5;
                chain.length = 0;
                for (const c of [COLORS[0], COLORS[0]]) chain.push({ color: c });
                const p = ballPos(0);
                fireTestShot(COLORS[0], p.x, p.y);
                step(0.016);
                return { level, state, pending, front: chainFront };
            });
            expect(s.level).toBe(2);
            expect(s.state).toBe('running');
            expect(s.pending).toBeGreaterThan(0);
            expect(s.front).toBeLessThan(10);
        });

        test('clearing a level awards a bonus', async ({ page }) => {
            const s = await page.evaluate(() => {
                startGame();
                pending = 0;
                score = 0;
                chainFront = pathLength() * 0.5;
                chain.length = 0;
                for (const c of [COLORS[0], COLORS[0]]) chain.push({ color: c });
                const p = ballPos(0);
                fireTestShot(COLORS[0], p.x, p.y);
                step(0.016);
                return score;
            });
            expect(s).toBeGreaterThanOrEqual(await page.evaluate(() => LEVEL_BONUS));
        });

        test('the level indicator updates in the HUD', async ({ page }) => {
            await page.evaluate(() => {
                startGame();
                level = 4;
                updateHud();
            });
            await expect(page.locator('#level')).toHaveText('4');
        });

        test('the marbles-left indicator counts the queue and the chain', async ({ page }) => {
            await page.evaluate(() => {
                startGame();
                pending = 7;
                chain.length = 0;
                chain.push({ color: COLORS[0] }, { color: COLORS[1] });
                updateHud();
            });
            await expect(page.locator('#left')).toHaveText('9');
        });
    });

    test.describe('losing', () => {
        test('the game ends when the leader reaches the pit', async ({ page }) => {
            const s = await page.evaluate(() => {
                startGame();
                pending = 0;
                chain.length = 0;
                chain.push({ color: COLORS[0] });
                chainFront = pathLength() - 1;
                for (let i = 0; i < 200; i++) step(0.016);
                return state;
            });
            expect(s).toBe('over');
        });

        test('game over shows the overlay with Play Again', async ({ page }) => {
            await page.evaluate(() => { startGame(); endGame(); });
            await expect(page.locator('#overlay')).toHaveClass(/visible/);
            await expect(page.locator('#btn-start')).toHaveText('Play Again');
        });

        test('an empty chain never triggers a loss', async ({ page }) => {
            const s = await page.evaluate(() => {
                startGame();
                pending = 0;
                chain.length = 0;
                chainFront = pathLength() + 500;
                step(0.016);
                return state;
            });
            expect(s).not.toBe('over');
        });
    });

    // -----------------------------------------------------------------------
    // Pause, best score and restart
    // -----------------------------------------------------------------------
    test.describe('pause and restart', () => {
        test('pausing freezes the chain', async ({ page }) => {
            const s = await page.evaluate(() => {
                startGame();
                togglePause();
                const before = chainFront;
                for (let i = 0; i < 30; i++) step(0.016);
                return { before, after: chainFront };
            });
            expect(s.after).toBe(s.before);
        });

        test('resuming lets the chain advance again', async ({ page }) => {
            const moved = await page.evaluate(() => {
                startGame();
                togglePause();
                togglePause();
                const before = chainFront;
                for (let i = 0; i < 30; i++) step(0.016);
                return chainFront > before;
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

        test('best score updates on game over when beaten', async ({ page }) => {
            await page.evaluate(() => {
                startGame();
                score = 1234;
                updateHud();
                endGame();
            });
            await expect(page.locator('#best')).toHaveText('1234');
        });

        test('best score persists to localStorage', async ({ page }) => {
            await page.evaluate(() => {
                startGame();
                score = 777;
                updateHud();
                endGame();
            });
            const stored = await page.evaluate(() => window.localStorage.getItem('marble-spiral-best'));
            expect(parseInt(stored, 10)).toBe(777);
        });

        test('best score is not lowered by a worse run', async ({ page }) => {
            await page.evaluate(() => window.localStorage.setItem('marble-spiral-best', '9000'));
            await page.reload();
            await page.evaluate(() => {
                startGame();
                score = 10;
                updateHud();
                endGame();
            });
            await expect(page.locator('#best')).toHaveText('9000');
        });

        test('restarting resets score, level, chain and shots', async ({ page }) => {
            const s = await page.evaluate(() => {
                startGame();
                score = 999;
                level = 6;
                shots.push({ x: 1, y: 1, vx: 0, vy: 0, color: COLORS[0] });
                endGame();
                startGame();
                return { score, level, shots: shots.length, state, front: chainFront };
            });
            expect(s.score).toBe(0);
            expect(s.level).toBe(1);
            expect(s.shots).toBe(0);
            expect(s.state).toBe('running');
            expect(s.front).toBeLessThan(10);
        });
    });
});
