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

        test('score and best start at 0', async ({ page }) => {
            await expect(page.locator('#score')).toHaveText('0');
            await expect(page.locator('#best')).toHaveText('0');
        });

        test('canvas is 640x560', async ({ page }) => {
            const canvas = page.locator('#canvas');
            await expect(canvas).toHaveAttribute('width', '640');
            await expect(canvas).toHaveAttribute('height', '560');
        });

        test('state is idle before starting', async ({ page }) => {
            expect(await page.evaluate(() => state)).toBe('idle');
        });

        test('no marbles or projectiles before starting', async ({ page }) => {
            const counts = await page.evaluate(() => ({
                marbles: marbles.length,
                projectiles: projectiles.length,
            }));
            expect(counts).toEqual({ marbles: 0, projectiles: 0 });
        });

        test('best score loads from localStorage', async ({ page }) => {
            await page.evaluate(() => window.localStorage.setItem('marbleshooter-best', '742'));
            await page.reload();
            await expect(page.locator('#best')).toHaveText('742');
        });
    });

    // -----------------------------------------------------------------------
    // The track
    // -----------------------------------------------------------------------
    test.describe('track', () => {
        test('the track has a positive length', async ({ page }) => {
            expect(await page.evaluate(() => pathLength())).toBeGreaterThan(500);
        });

        test('pointAt returns points inside the canvas', async ({ page }) => {
            const ok = await page.evaluate(() => {
                const len = pathLength();
                for (let i = 0; i <= 100; i++) {
                    const p = pointAt((len * i) / 100);
                    if (p.x < 0 || p.x > CANVAS_W || p.y < 0 || p.y > CANVAS_H) return false;
                }
                return true;
            });
            expect(ok).toBe(true);
        });

        test('pointAt is monotonic along the track (no jumps)', async ({ page }) => {
            const maxJump = await page.evaluate(() => {
                const len = pathLength();
                let worst = 0;
                let prev = pointAt(0);
                for (let d = 5; d <= len; d += 5) {
                    const p = pointAt(d);
                    worst = Math.max(worst, Math.hypot(p.x - prev.x, p.y - prev.y));
                    prev = p;
                }
                return worst;
            });
            // Sampling every 5px along the arc should never move more than ~5px.
            expect(maxJump).toBeLessThan(8);
        });

        test('pointAt clamps distances beyond the ends of the track', async ({ page }) => {
            const same = await page.evaluate(() => {
                const len = pathLength();
                const end = pointAt(len);
                const past = pointAt(len + 500);
                const start = pointAt(0);
                const before = pointAt(-100);
                return (
                    Math.hypot(end.x - past.x, end.y - past.y) < 0.001 &&
                    Math.hypot(start.x - before.x, start.y - before.y) < 0.001
                );
            });
            expect(same).toBe(true);
        });

        test('the track ends at the pit next to the shooter', async ({ page }) => {
            const dist = await page.evaluate(() => {
                const end = pointAt(pathLength());
                return Math.hypot(end.x - shooter.x, end.y - shooter.y);
            });
            expect(dist).toBeLessThan(140);
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

        test('Start button starts the game', async ({ page }) => {
            await page.locator('#btn-start').click();
            expect(await page.evaluate(() => state)).toBe('running');
        });

        test('game starts on level 1 with a zero score', async ({ page }) => {
            const s = await page.evaluate(() => { startGame(); return { level, score, state }; });
            expect(s).toEqual({ level: 1, score: 0, state: 'running' });
        });

        test('the level starts with a full queue of marbles to spawn', async ({ page }) => {
            const s = await page.evaluate(() => {
                startGame();
                return { remaining, expected: marblesForLevel(1) };
            });
            expect(s.remaining).toBe(s.expected);
            expect(s.remaining).toBeGreaterThan(0);
        });

        test('the shooter is loaded with a current and a next marble', async ({ page }) => {
            const s = await page.evaluate(() => {
                startGame();
                return { current: currentBall, next: nextBall, colors: COLORS };
            });
            expect(s.colors).toContain(s.current);
            expect(s.colors).toContain(s.next);
        });

        test('marbles start spawning as time passes', async ({ page }) => {
            const count = await page.evaluate(() => {
                startGame();
                for (let i = 0; i < 300; i++) step(0.016);
                return marbles.length;
            });
            expect(count).toBeGreaterThan(0);
        });
    });

    // -----------------------------------------------------------------------
    // The chain
    // -----------------------------------------------------------------------
    test.describe('chain', () => {
        test('setMarbles builds a chain in head-first order', async ({ page }) => {
            const s = await page.evaluate(() => {
                startGame();
                setMarbles([COLORS[0], COLORS[1], COLORS[2]], 200);
                return { n: marbles.length, colors: marbles.map((m) => m.color), head: marbles[0].d };
            });
            expect(s.n).toBe(3);
            expect(s.colors).toEqual(await page.evaluate(() => [COLORS[0], COLORS[1], COLORS[2]]));
            expect(s.head).toBe(200);
        });

        test('marbles are evenly spaced one diameter apart', async ({ page }) => {
            const gaps = await page.evaluate(() => {
                startGame();
                setMarbles([COLORS[0], COLORS[1], COLORS[2], COLORS[3]], 300);
                const out = [];
                for (let i = 1; i < marbles.length; i++) out.push(marbles[i - 1].d - marbles[i].d);
                return { out, spacing: MARBLE_D };
            });
            for (const g of gaps.out) expect(g).toBeCloseTo(gaps.spacing, 6);
        });

        test('the chain crawls forward over time', async ({ page }) => {
            const { before, after } = await page.evaluate(() => {
                startGame();
                setMarbles([COLORS[0], COLORS[1], COLORS[2]], 100);
                const before = marbles[0].d;
                for (let i = 0; i < 60; i++) step(0.016);
                return { before, after: marbles[0].d };
            });
            expect(after).toBeGreaterThan(before);
        });

        test('the whole chain moves together, keeping its spacing', async ({ page }) => {
            const gaps = await page.evaluate(() => {
                startGame();
                setMarbles([COLORS[0], COLORS[1], COLORS[2], COLORS[4]], 120);
                for (let i = 0; i < 120; i++) step(0.016);
                const out = [];
                for (let i = 1; i < marbles.length; i++) out.push(marbles[i - 1].d - marbles[i].d);
                return { out, spacing: MARBLE_D };
            });
            for (const g of gaps.out) expect(g).toBeCloseTo(gaps.spacing, 6);
        });

        test('the chain crawls faster on later levels', async ({ page }) => {
            const { slow, fast } = await page.evaluate(() => {
                startGame();
                level = 1;
                setMarbles([COLORS[0]], 100);
                step(0.5);
                const slow = marbles[0].d - 100;
                level = 7;
                setMarbles([COLORS[0]], 100);
                step(0.5);
                const fast = marbles[0].d - 100;
                return { slow, fast };
            });
            expect(fast).toBeGreaterThan(slow);
        });

        test('spawning stops once the level queue is empty', async ({ page }) => {
            const s = await page.evaluate(() => {
                startGame();
                remaining = 2;
                marbles.length = 0;
                for (let i = 0; i < 600; i++) step(0.016);
                return { remaining, spawned: marbles.length };
            });
            expect(s.remaining).toBe(0);
            expect(s.spawned).toBeLessThanOrEqual(2);
        });
    });

    // -----------------------------------------------------------------------
    // Aiming and shooting
    // -----------------------------------------------------------------------
    test.describe('aiming and shooting', () => {
        test('setAim points the shooter at a canvas coordinate', async ({ page }) => {
            const angle = await page.evaluate(() => {
                startGame();
                setAim(shooter.x + 100, shooter.y);
                return aimAngle;
            });
            expect(Math.abs(Math.sin(angle))).toBeLessThan(0.001);
            expect(Math.cos(angle)).toBeCloseTo(1, 5);
        });

        test('shoot launches a projectile in the aimed direction', async ({ page }) => {
            const p = await page.evaluate(() => {
                startGame();
                setAim(shooter.x, shooter.y - 100);
                shoot();
                return { n: projectiles.length, vx: projectiles[0].vx, vy: projectiles[0].vy };
            });
            expect(p.n).toBe(1);
            expect(p.vy).toBeLessThan(0);
            expect(Math.abs(p.vx)).toBeLessThan(1);
        });

        test('shooting consumes the loaded marble and queues a new one', async ({ page }) => {
            const s = await page.evaluate(() => {
                startGame();
                const loaded = currentBall;
                const queued = nextBall;
                shootAt(shooter.x, 0);
                return { loaded, queued, fired: projectiles[0].color, current: currentBall };
            });
            expect(s.fired).toBe(s.loaded);
            expect(s.current).toBe(s.queued);
        });

        test('swapBalls exchanges the loaded and queued marbles', async ({ page }) => {
            const s = await page.evaluate(() => {
                startGame();
                currentBall = COLORS[0];
                nextBall = COLORS[1];
                swapBalls();
                return { current: currentBall, next: nextBall, a: COLORS[0], b: COLORS[1] };
            });
            expect(s.current).toBe(s.b);
            expect(s.next).toBe(s.a);
        });

        test('projectiles travel across the board', async ({ page }) => {
            const moved = await page.evaluate(() => {
                startGame();
                marbles.length = 0;
                remaining = 0;
                setAim(shooter.x, shooter.y - 100);
                shoot();
                const y0 = projectiles[0].y;
                step(0.02);
                return y0 - projectiles[0].y;
            });
            expect(moved).toBeGreaterThan(0);
        });

        test('a projectile that leaves the canvas is discarded', async ({ page }) => {
            const n = await page.evaluate(() => {
                startGame();
                marbles.length = 0;
                remaining = 0;
                setAim(shooter.x, shooter.y - 100);
                shoot();
                for (let i = 0; i < 120; i++) step(0.016);
                return projectiles.length;
            });
            expect(n).toBe(0);
        });

        test('clicking the canvas fires a marble', async ({ page }) => {
            await page.evaluate(() => { startGame(); marbles.length = 0; remaining = 0; });
            await page.locator('#canvas').click({ position: { x: 320, y: 10 } });
            expect(await page.evaluate(() => projectiles.length)).toBe(1);
        });

        test('arrow keys rotate the aim', async ({ page }) => {
            await page.evaluate(() => { startGame(); setAim(shooter.x, shooter.y - 100); });
            const before = await page.evaluate(() => aimAngle);
            await page.keyboard.press('ArrowRight');
            const after = await page.evaluate(() => aimAngle);
            expect(after).not.toBe(before);
        });

        test('no shooting while the game is idle', async ({ page }) => {
            const n = await page.evaluate(() => {
                shootAt(320, 0);
                return projectiles.length;
            });
            expect(n).toBe(0);
        });
    });

    // -----------------------------------------------------------------------
    // Insertion
    // -----------------------------------------------------------------------
    test.describe('insertion', () => {
        test('a shot that hits the chain without a match is inserted', async ({ page }) => {
            const s = await page.evaluate(() => {
                startGame();
                remaining = 0;
                setMarbles([COLORS[0], COLORS[1], COLORS[2], COLORS[3]], 300);
                const target = pointAt(marbles[2].d);
                currentBall = COLORS[4];
                shootAt(target.x, target.y);
                for (let i = 0; i < 200; i++) step(0.004);
                return { n: marbles.length, colors: marbles.map((m) => m.color), added: COLORS[4] };
            });
            expect(s.n).toBe(5);
            expect(s.colors).toContain(s.added);
        });

        test('insertion shoves the chain one marble closer to the pit', async ({ page }) => {
            const s = await page.evaluate(() => {
                startGame();
                remaining = 0;
                level = 1;
                setMarbles([COLORS[0], COLORS[1], COLORS[2], COLORS[3]], 300);
                const target = pointAt(marbles[2].d);
                currentBall = COLORS[4];
                const headBefore = marbles[0].d;
                shootAt(target.x, target.y);
                let steps = 0;
                while (marbles.length === 4 && steps < 400) { step(0.001); steps++; }
                // crawl over those steps is tiny compared with a marble diameter
                return { headBefore, headAfter: marbles[0].d, d: MARBLE_D };
            });
            expect(s.headAfter - s.headBefore).toBeGreaterThan(s.d * 0.8);
        });

        test('the chain stays evenly spaced after an insertion', async ({ page }) => {
            const s = await page.evaluate(() => {
                startGame();
                remaining = 0;
                setMarbles([COLORS[0], COLORS[1], COLORS[2], COLORS[3]], 300);
                const target = pointAt(marbles[2].d);
                currentBall = COLORS[4];
                shootAt(target.x, target.y);
                for (let i = 0; i < 200; i++) step(0.004);
                const out = [];
                for (let i = 1; i < marbles.length; i++) out.push(marbles[i - 1].d - marbles[i].d);
                return { out, spacing: MARBLE_D };
            });
            for (const g of s.out) expect(g).toBeCloseTo(s.spacing, 6);
        });

        test('the projectile is removed once it joins the chain', async ({ page }) => {
            const n = await page.evaluate(() => {
                startGame();
                remaining = 0;
                setMarbles([COLORS[0], COLORS[1], COLORS[2], COLORS[3]], 300);
                const target = pointAt(marbles[2].d);
                currentBall = COLORS[4];
                shootAt(target.x, target.y);
                for (let i = 0; i < 200; i++) step(0.004);
                return projectiles.length;
            });
            expect(n).toBe(0);
        });
    });

    // -----------------------------------------------------------------------
    // Matching and popping
    // -----------------------------------------------------------------------
    test.describe('matching', () => {
        test('three of a colour pop and leave the rest of the chain', async ({ page }) => {
            const s = await page.evaluate(() => {
                startGame();
                remaining = 0;
                // red red blue ... shoot a red at the front pair
                setMarbles([COLORS[0], COLORS[0], COLORS[1], COLORS[2]], 300);
                const target = pointAt(marbles[0].d);
                currentBall = COLORS[0];
                shootAt(target.x, target.y);
                for (let i = 0; i < 400; i++) step(0.002);
                return { colors: marbles.map((m) => m.color), red: COLORS[0] };
            });
            expect(s.colors).not.toContain(s.red);
            expect(s.colors.length).toBe(2);
        });

        test('popping a run scores points', async ({ page }) => {
            const s = await page.evaluate(() => {
                startGame();
                remaining = 0;
                score = 0;
                setMarbles([COLORS[0], COLORS[0], COLORS[1]], 300);
                const target = pointAt(marbles[0].d);
                currentBall = COLORS[0];
                shootAt(target.x, target.y);
                for (let i = 0; i < 400; i++) step(0.002);
                return score;
            });
            expect(s).toBeGreaterThan(0);
        });

        test('two of a colour do not pop', async ({ page }) => {
            const n = await page.evaluate(() => {
                startGame();
                remaining = 0;
                setMarbles([COLORS[0], COLORS[1], COLORS[2], COLORS[3]], 300);
                const target = pointAt(marbles[0].d);
                currentBall = COLORS[0];
                shootAt(target.x, target.y);
                for (let i = 0; i < 400; i++) step(0.002);
                return marbles.length;
            });
            expect(n).toBe(5);
        });

        test('a run longer than three pops entirely', async ({ page }) => {
            const s = await page.evaluate(() => {
                startGame();
                remaining = 0;
                setMarbles([COLORS[0], COLORS[0], COLORS[0], COLORS[0], COLORS[1]], 320);
                const target = pointAt(marbles[0].d);
                currentBall = COLORS[0];
                shootAt(target.x, target.y);
                for (let i = 0; i < 400; i++) step(0.002);
                return marbles.map((m) => m.color);
            });
            expect(s.length).toBe(1);
        });

        test('a pop closes the gap and the chain stays evenly spaced', async ({ page }) => {
            const s = await page.evaluate(() => {
                startGame();
                remaining = 0;
                // blue | red red | blue blue  -> shooting red pops the middle
                setMarbles([COLORS[1], COLORS[0], COLORS[0], COLORS[2], COLORS[2]], 340);
                const target = pointAt(marbles[1].d);
                currentBall = COLORS[0];
                shootAt(target.x, target.y);
                for (let i = 0; i < 400; i++) step(0.002);
                const out = [];
                for (let i = 1; i < marbles.length; i++) out.push(marbles[i - 1].d - marbles[i].d);
                return { n: marbles.length, out, spacing: MARBLE_D };
            });
            expect(s.n).toBe(3);
            for (const g of s.out) expect(g).toBeCloseTo(s.spacing, 6);
        });

        test('popping the head group does not lurch the chain forward', async ({ page }) => {
            const s = await page.evaluate(() => {
                startGame();
                remaining = 0;
                setMarbles([COLORS[0], COLORS[0], COLORS[1], COLORS[1]], 300);
                const target = pointAt(marbles[0].d);
                currentBall = COLORS[0];
                const secondBefore = marbles[2].d; // first surviving marble
                shootAt(target.x, target.y);
                let steps = 0;
                while (marbles.length === 4 && steps < 600) { step(0.001); steps++; }
                return { secondBefore, headAfter: marbles[0].d, spacing: MARBLE_D };
            });
            // head of the surviving chain keeps roughly the position it had
            expect(Math.abs(s.headAfter - s.secondBefore)).toBeLessThan(s.spacing);
        });

        test('a chain reaction pops both runs from one shot', async ({ page }) => {
            const s = await page.evaluate(() => {
                startGame();
                remaining = 0;
                // green green | red red | green green  -> a red shot pops the reds,
                // the greens then touch and pop too.
                setMarbles(
                    [COLORS[2], COLORS[2], COLORS[0], COLORS[0], COLORS[2], COLORS[2]],
                    360
                );
                const target = pointAt(marbles[2].d);
                currentBall = COLORS[0];
                shootAt(target.x, target.y);
                // Read the chain the moment the shot resolves — clearing the
                // board also advances the level, which starts refilling it.
                let settled = null;
                for (let i = 0; i < 600 && settled === null; i++) {
                    step(0.002);
                    if (!projectiles.length) settled = marbles.length;
                }
                return settled;
            });
            expect(s).toBe(0);
        });

        test('a chain reaction scores more than a plain pop', async ({ page }) => {
            const s = await page.evaluate(() => {
                function popScore(colors, hitIndex, ball) {
                    startGame();
                    remaining = 0;
                    score = 0;
                    setMarbles(colors, 380);
                    const target = pointAt(marbles[hitIndex].d);
                    currentBall = ball;
                    shootAt(target.x, target.y);
                    for (let i = 0; i < 600; i++) step(0.002);
                    return score;
                }
                const plain = popScore([COLORS[0], COLORS[0], COLORS[1], COLORS[3]], 0, COLORS[0]);
                const combo = popScore(
                    [COLORS[2], COLORS[2], COLORS[0], COLORS[0], COLORS[2], COLORS[2]],
                    2,
                    COLORS[0]
                );
                return { plain, combo };
            });
            expect(s.combo).toBeGreaterThan(s.plain * 2);
        });
    });

    // -----------------------------------------------------------------------
    // Losing
    // -----------------------------------------------------------------------
    test.describe('losing', () => {
        test('the game ends when the lead marble reaches the pit', async ({ page }) => {
            const s = await page.evaluate(() => {
                startGame();
                remaining = 0;
                setMarbles([COLORS[0], COLORS[1]], pathLength() - 2);
                for (let i = 0; i < 200; i++) step(0.016);
                return state;
            });
            expect(s).toBe('over');
        });

        test('the game keeps running while the chain is short of the pit', async ({ page }) => {
            const s = await page.evaluate(() => {
                startGame();
                remaining = 0;
                setMarbles([COLORS[0], COLORS[1]], pathLength() - 200);
                for (let i = 0; i < 10; i++) step(0.016);
                return state;
            });
            expect(s).toBe('running');
        });

        test('game over shows the overlay with Play Again', async ({ page }) => {
            await page.evaluate(() => { startGame(); endGame(); });
            await expect(page.locator('#overlay')).toHaveClass(/visible/);
            await expect(page.locator('#btn-start')).toHaveText('Play Again');
        });

        test('nothing moves after the game is over', async ({ page }) => {
            const s = await page.evaluate(() => {
                startGame();
                remaining = 0;
                setMarbles([COLORS[0], COLORS[1]], 200);
                endGame();
                const before = marbles[0].d;
                for (let i = 0; i < 30; i++) step(0.016);
                return { before, after: marbles[0].d };
            });
            expect(s.after).toBe(s.before);
        });
    });

    // -----------------------------------------------------------------------
    // Levels
    // -----------------------------------------------------------------------
    test.describe('levels', () => {
        test('clearing every marble advances the level', async ({ page }) => {
            const s = await page.evaluate(() => {
                startGame();
                remaining = 0;
                marbles.length = 0;
                for (let i = 0; i < 200; i++) step(0.016);
                return level;
            });
            expect(s).toBe(2);
        });

        test('later levels queue more marbles', async ({ page }) => {
            const s = await page.evaluate(() => ({
                l1: marblesForLevel(1),
                l2: marblesForLevel(2),
                l5: marblesForLevel(5),
            }));
            expect(s.l2).toBeGreaterThan(s.l1);
            expect(s.l5).toBeGreaterThan(s.l2);
        });

        test('later levels crawl faster', async ({ page }) => {
            const s = await page.evaluate(() => ({ l1: levelSpeed(1), l4: levelSpeed(4) }));
            expect(s.l4).toBeGreaterThan(s.l1);
        });

        test('later levels use more colours, capped at the palette size', async ({ page }) => {
            const s = await page.evaluate(() => ({
                l1: colorsForLevel(1),
                l3: colorsForLevel(3),
                l99: colorsForLevel(99),
                max: COLORS.length,
            }));
            expect(s.l1).toBeGreaterThanOrEqual(3);
            expect(s.l3).toBeGreaterThan(s.l1);
            expect(s.l99).toBe(s.max);
        });

        test('a new level refills the spawn queue and clears the board', async ({ page }) => {
            const s = await page.evaluate(() => {
                startGame();
                setMarbles([COLORS[0], COLORS[1]], 200);
                nextLevel();
                return { level, remaining, marbles: marbles.length, projectiles: projectiles.length };
            });
            expect(s.level).toBe(2);
            expect(s.marbles).toBe(0);
            expect(s.projectiles).toBe(0);
            expect(s.remaining).toBeGreaterThan(0);
        });

        test('the HUD shows the marbles left in the level', async ({ page }) => {
            await page.evaluate(() => {
                startGame();
                remaining = 4;
                setMarbles([COLORS[0], COLORS[1], COLORS[2]], 200);
                updateHud();
            });
            await expect(page.locator('#marbles')).toHaveText('7');
        });
    });

    // -----------------------------------------------------------------------
    // Scoring & best
    // -----------------------------------------------------------------------
    test.describe('scoring', () => {
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
                score = 555;
                updateHud();
                endGame();
            });
            const stored = await page.evaluate(() =>
                window.localStorage.getItem('marbleshooter-best')
            );
            expect(parseInt(stored, 10)).toBe(555);
        });

        test('best score is not lowered by a worse run', async ({ page }) => {
            await page.evaluate(() => window.localStorage.setItem('marbleshooter-best', '9000'));
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
    // Pause & restart
    // -----------------------------------------------------------------------
    test.describe('pause and restart', () => {
        test('pausing freezes the chain', async ({ page }) => {
            const s = await page.evaluate(() => {
                startGame();
                remaining = 0;
                setMarbles([COLORS[0], COLORS[1]], 150);
                togglePause();
                const before = marbles[0].d;
                for (let i = 0; i < 20; i++) step(0.016);
                return { before, after: marbles[0].d, state };
            });
            expect(s.state).toBe('paused');
            expect(s.after).toBe(s.before);
        });

        test('resuming lets the chain crawl again', async ({ page }) => {
            const moved = await page.evaluate(() => {
                startGame();
                remaining = 0;
                setMarbles([COLORS[0], COLORS[1]], 150);
                togglePause();
                togglePause();
                const before = marbles[0].d;
                for (let i = 0; i < 20; i++) step(0.016);
                return marbles[0].d > before;
            });
            expect(moved).toBe(true);
        });

        test('P toggles pause', async ({ page }) => {
            await page.evaluate(() => startGame());
            await page.keyboard.press('KeyP');
            expect(await page.evaluate(() => state)).toBe('paused');
            await page.keyboard.press('KeyP');
            expect(await page.evaluate(() => state)).toBe('running');
        });

        test('restart after game over resets score, level, chain and projectiles', async ({ page }) => {
            const s = await page.evaluate(() => {
                startGame();
                score = 999;
                level = 6;
                setMarbles([COLORS[0], COLORS[1]], 200);
                shootAt(shooter.x, 0);
                endGame();
                startGame();
                return {
                    score,
                    level,
                    marbles: marbles.length,
                    projectiles: projectiles.length,
                    state,
                };
            });
            expect(s).toEqual({
                score: 0,
                level: 1,
                marbles: 0,
                projectiles: 0,
                state: 'running',
            });
        });
    });

    // -----------------------------------------------------------------------
    // Determinism
    // -----------------------------------------------------------------------
    test.describe('determinism', () => {
        test('the same seed produces the same level', async ({ page }) => {
            const s = await page.evaluate(() => {
                function run() {
                    setSeed(42);
                    startGame();
                    for (let i = 0; i < 400; i++) step(0.016);
                    return marbles.map((m) => m.color).join(',');
                }
                return { a: run(), b: run() };
            });
            expect(s.a).toBe(s.b);
            expect(s.a.length).toBeGreaterThan(0);
        });

        test('different seeds produce different levels', async ({ page }) => {
            const s = await page.evaluate(() => {
                function run(seed) {
                    setSeed(seed);
                    startGame();
                    for (let i = 0; i < 400; i++) step(0.016);
                    return marbles.map((m) => m.color).join(',');
                }
                return { a: run(1), b: run(999) };
            });
            expect(s.a).not.toBe(s.b);
        });
    });
});
