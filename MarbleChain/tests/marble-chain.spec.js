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

        test('score and level read their starting values', async ({ page }) => {
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

        test('the chain is empty before starting', async ({ page }) => {
            expect(await page.evaluate(() => chain.balls.length)).toBe(0);
        });

        test('best score loads from localStorage', async ({ page }) => {
            await page.evaluate(() => window.localStorage.setItem('marble-chain-best', '4210'));
            await page.reload();
            await expect(page.locator('#best')).toHaveText('4210');
        });
    });

    // -----------------------------------------------------------------------
    // The path
    // -----------------------------------------------------------------------
    test.describe('the spiral path', () => {
        test('the path has a positive length', async ({ page }) => {
            expect(await page.evaluate(() => PATH_LENGTH)).toBeGreaterThan(1000);
        });

        test('every point on the path is inside the canvas', async ({ page }) => {
            const ok = await page.evaluate(() => {
                for (let d = 0; d <= PATH_LENGTH; d += 5) {
                    const p = pathPointAt(d);
                    if (p.x < BALL_R || p.x > CANVAS_W - BALL_R) return false;
                    if (p.y < BALL_R || p.y > CANVAS_H - BALL_R) return false;
                }
                return true;
            });
            expect(ok).toBe(true);
        });

        test('path distance is clamped at both ends', async ({ page }) => {
            const same = await page.evaluate(() => {
                const a = pathPointAt(-500), b = pathPointAt(0);
                const c = pathPointAt(PATH_LENGTH + 500), d = pathPointAt(PATH_LENGTH);
                return a.x === b.x && a.y === b.y && c.x === d.x && c.y === d.y;
            });
            expect(same).toBe(true);
        });

        test('walking the path moves roughly one unit per unit of distance', async ({ page }) => {
            const ratio = await page.evaluate(() => {
                const a = pathPointAt(400), b = pathPointAt(410);
                return Math.hypot(b.x - a.x, b.y - a.y) / 10;
            });
            expect(ratio).toBeGreaterThan(0.9);
            expect(ratio).toBeLessThan(1.1);
        });

        test('the path spirals inward — it ends nearer the centre than it starts', async ({ page }) => {
            const { startR, endR } = await page.evaluate(() => {
                const s = pathPointAt(0), e = pathPointAt(PATH_LENGTH);
                return {
                    startR: Math.hypot(s.x - CENTER_X, s.y - CENTER_Y),
                    endR: Math.hypot(e.x - CENTER_X, e.y - CENTER_Y),
                };
            });
            expect(endR).toBeLessThan(startR);
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

        test('a fresh game starts on level 1 with score 0', async ({ page }) => {
            const s = await page.evaluate(() => { startGame(); return { level, score, state }; });
            expect(s.level).toBe(1);
            expect(s.score).toBe(0);
            expect(s.state).toBe('running');
        });

        test('the level starts with marbles queued to be released', async ({ page }) => {
            expect(await page.evaluate(() => { startGame(); return spawnsRemaining; })).toBeGreaterThan(0);
        });

        test('the turret holds a current and a next marble', async ({ page }) => {
            const s = await page.evaluate(() => { startGame(); return { cur: shooter.current, next: shooter.next }; });
            expect(s.cur).toBeGreaterThanOrEqual(0);
            expect(s.next).toBeGreaterThanOrEqual(0);
        });

        test('the chain starts at the mouth of the path', async ({ page }) => {
            expect(await page.evaluate(() => { startGame(); return chain.head; })).toBeLessThan(50);
        });
    });

    // -----------------------------------------------------------------------
    // Chain movement and spawning
    // -----------------------------------------------------------------------
    test.describe('the chain', () => {
        test('the chain crawls forward over time', async ({ page }) => {
            const { before, after } = await page.evaluate(() => {
                startGame();
                const before = chain.head;
                for (let i = 0; i < 60; i++) step(0.016);
                return { before, after: chain.head };
            });
            expect(after).toBeGreaterThan(before);
        });

        test('marbles are released from the tunnel as room appears', async ({ page }) => {
            const count = await page.evaluate(() => {
                startGame();
                for (let i = 0; i < 600; i++) step(0.016);
                return chain.balls.length;
            });
            expect(count).toBeGreaterThan(3);
        });

        test('releasing marbles draws down the level queue', async ({ page }) => {
            const { before, after } = await page.evaluate(() => {
                startGame();
                const before = spawnsRemaining;
                for (let i = 0; i < 600; i++) step(0.016);
                return { before, after: spawnsRemaining };
            });
            expect(after).toBeLessThan(before);
        });

        test('marbles are packed one spacing apart along the path', async ({ page }) => {
            const gaps = await page.evaluate(() => {
                startGame();
                setChain([0, 1, 2, 3], 400);
                return [ballDist(0) - ballDist(1), ballDist(1) - ballDist(2), ballDist(2) - ballDist(3)];
            });
            for (const gap of gaps) expect(gap).toBeCloseTo(22, 5);
        });

        test('ballPos matches the path point for that distance', async ({ page }) => {
            const same = await page.evaluate(() => {
                startGame();
                setChain([0, 1, 2], 300);
                const p = ballPos(1), q = pathPointAt(ballDist(1));
                return Math.hypot(p.x - q.x, p.y - q.y) < 0.001;
            });
            expect(same).toBe(true);
        });

        test('the chain moves faster on later levels', async ({ page }) => {
            const { slow, fast } = await page.evaluate(() => {
                startGame();
                level = 1;
                setChain([0], 0);
                step(1);
                const slow = chain.head;
                level = 6;
                setChain([0], 0);
                step(1);
                return { slow, fast: chain.head };
            });
            expect(fast).toBeGreaterThan(slow);
        });
    });

    // -----------------------------------------------------------------------
    // Shooting
    // -----------------------------------------------------------------------
    test.describe('shooting', () => {
        test('shoot launches a projectile from the turret', async ({ page }) => {
            const p = await page.evaluate(() => {
                startGame();
                projectiles.length = 0;
                setAim(0);
                shoot();
                return { n: projectiles.length, x: projectiles[0].x, y: projectiles[0].y };
            });
            expect(p.n).toBe(1);
            expect(p.x).toBeCloseTo(360, 0);   // CENTER_X
            expect(p.y).toBeCloseTo(260, 0);   // CENTER_Y
        });

        test('shooting promotes the next marble to current', async ({ page }) => {
            const { queued, current } = await page.evaluate(() => {
                startGame();
                const queued = shooter.next;
                shoot();
                return { queued, current: shooter.current };
            });
            expect(current).toBe(queued);
        });

        test('a projectile travels along the aim angle', async ({ page }) => {
            const p = await page.evaluate(() => {
                startGame();
                projectiles.length = 0;
                setAim(0);
                spawnProjectile({ angle: 0, color: 0 });
                const x0 = projectiles[0].x, y0 = projectiles[0].y;
                step(0.1);
                return { dx: projectiles[0].x - x0, dy: projectiles[0].y - y0 };
            });
            expect(p.dx).toBeGreaterThan(0);
            expect(Math.abs(p.dy)).toBeLessThan(0.001);
        });

        test('projectiles that leave the canvas are discarded', async ({ page }) => {
            const n = await page.evaluate(() => {
                startGame();
                chain.balls.length = 0;
                spawnsRemaining = 0;
                projectiles.length = 0;
                spawnProjectile({ angle: 0, color: 0 });
                for (let i = 0; i < 120; i++) step(0.016);
                return projectiles.length;
            });
            expect(n).toBe(0);
        });

        test('setAim points the turret', async ({ page }) => {
            const a = await page.evaluate(() => { startGame(); setAim(1.25); return shooter.angle; });
            expect(a).toBeCloseTo(1.25, 5);
        });

        test('S swaps the current and next marbles', async ({ page }) => {
            const s = await page.evaluate(() => {
                startGame();
                shooter.current = 0;
                shooter.next = 3;
                swapShooter();
                return { cur: shooter.current, next: shooter.next };
            });
            expect(s.cur).toBe(3);
            expect(s.next).toBe(0);
        });

        test('the turret is only ever loaded with colours present in the chain', async ({ page }) => {
            const ok = await page.evaluate(() => {
                startGame();
                setChain([2, 2, 2, 2, 2, 2], 400);
                spawnsRemaining = 0;
                for (let i = 0; i < 20; i++) { shoot(); projectiles.length = 0; }
                return shooter.current === 2 && shooter.next === 2;
            });
            expect(ok).toBe(true);
        });
    });

    test.describe('restocking the turret', () => {
        test('a loaded marble whose colour has left the track is replaced', async ({ page }) => {
            const s = await page.evaluate(() => {
                startGame();
                spawnsRemaining = 0;
                setChain([2, 2, 2, 2], 400);
                shooter.current = 0;
                shooter.next = 1;
                step(0.016);
                return { cur: shooter.current, next: shooter.next };
            });
            expect(s.cur).toBe(2);
            expect(s.next).toBe(2);
        });

        test('a loaded marble whose colour is still on the track is kept', async ({ page }) => {
            const s = await page.evaluate(() => {
                startGame();
                spawnsRemaining = 0;
                setChain([2, 3, 2, 3], 400);
                shooter.current = 3;
                shooter.next = 2;
                step(0.016);
                return { cur: shooter.current, next: shooter.next };
            });
            expect(s.cur).toBe(3);
            expect(s.next).toBe(2);
        });

        test('an empty chain leaves the turret alone', async ({ page }) => {
            const cur = await page.evaluate(() => {
                startGame();
                spawnsRemaining = 3;
                chain.balls.length = 0;
                shooter.current = 4;
                refreshShooterColors();
                return shooter.current;
            });
            expect(cur).toBe(4);
        });
    });

    // -----------------------------------------------------------------------
    // Insertion
    // -----------------------------------------------------------------------
    test.describe('insertion', () => {
        test('a projectile that reaches the chain is absorbed into it', async ({ page }) => {
            const r = await page.evaluate(() => {
                startGame();
                setChain([0, 1, 0, 1], 400);
                spawnsRemaining = 0;
                projectiles.length = 0;
                const target = ballPos(2);
                spawnProjectile({ x: target.x, y: target.y - 1, color: 3, angle: 0, vx: 0, vy: 0 });
                step(0.016);
                return { projectiles: projectiles.length, chain: chain.balls.length };
            });
            expect(r.projectiles).toBe(0);
            expect(r.chain).toBe(5);
        });

        test('insertBall places the colour at the requested index', async ({ page }) => {
            const colors = await page.evaluate(() => {
                startGame();
                setChain([0, 1, 2], 400);
                insertBall(1, 4);
                return chain.balls.map((b) => b.color);
            });
            expect(colors).toEqual([0, 4, 1, 2]);
        });

        test('insertion lengthens the tail and leaves the head where it was', async ({ page }) => {
            const r = await page.evaluate(() => {
                startGame();
                setChain([0, 1, 2], 400);
                const head = chain.head, tail = ballDist(2);
                insertBall(1, 4);
                return { head, newHead: chain.head, tail, newTail: ballDist(3) };
            });
            expect(r.newHead).toBe(r.head);
            expect(r.newTail).toBeLessThan(r.tail);
        });

        test('marbles still in the tunnel are not hit by projectiles', async ({ page }) => {
            const n = await page.evaluate(() => {
                startGame();
                // head at 0 means every marble but the first is behind the mouth
                setChain([0, 1, 2, 3], 0);
                spawnsRemaining = 0;
                projectiles.length = 0;
                const mouth = pathPointAt(0);
                spawnProjectile({ x: mouth.x, y: mouth.y - 40, color: 4, angle: 0, vx: 0, vy: 0 });
                step(0.016);
                return chain.balls.length;
            });
            expect(n).toBe(4);
        });
    });

    // -----------------------------------------------------------------------
    // Matching
    // -----------------------------------------------------------------------
    test.describe('matching', () => {
        test('three of a colour are removed', async ({ page }) => {
            const colors = await page.evaluate(() => {
                startGame();
                setChain([1, 0, 0, 1], 400);
                insertBall(2, 0);
                resolveMatches(2);
                return chain.balls.map((b) => b.color);
            });
            expect(colors).toEqual([1, 1]);
        });

        test('two of a colour are left alone', async ({ page }) => {
            const n = await page.evaluate(() => {
                startGame();
                setChain([1, 0, 1], 400);
                insertBall(2, 0);
                resolveMatches(2);
                return chain.balls.length;
            });
            expect(n).toBe(4);
        });

        test('longer runs are removed whole', async ({ page }) => {
            const colors = await page.evaluate(() => {
                startGame();
                setChain([2, 0, 0, 0, 0, 2], 400);
                insertBall(3, 0);
                resolveMatches(3);
                return chain.balls.map((b) => b.color);
            });
            expect(colors).toEqual([2, 2]);
        });

        test('clearing marbles scores points', async ({ page }) => {
            const s = await page.evaluate(() => {
                startGame();
                score = 0;
                setChain([1, 0, 0, 1], 400);
                insertBall(2, 0);
                resolveMatches(2);
                return score;
            });
            expect(s).toBe(30);
        });

        test('a chain reaction fires when the seam matches', async ({ page }) => {
            const colors = await page.evaluate(() => {
                startGame();
                // inserting a 0 at index 2 clears three 0s, leaving 1,1,1 which also clears
                setChain([1, 1, 0, 0, 1], 400);
                insertBall(2, 0);
                resolveMatches(2);
                return chain.balls.map((b) => b.color);
            });
            expect(colors).toEqual([]);
        });

        test('a chain reaction scores a combo multiplier', async ({ page }) => {
            const { plain, combo } = await page.evaluate(() => {
                startGame();
                score = 0;
                setChain([1, 0, 0, 2], 400);
                insertBall(2, 0);
                resolveMatches(2);
                const plain = score;
                score = 0;
                setChain([1, 1, 0, 0, 1], 400);
                insertBall(2, 0);
                resolveMatches(2);
                return { plain, combo: score };
            });
            // 30 for the first blast, then 3 marbles at double for the reaction
            expect(plain).toBe(30);
            expect(combo).toBe(30 + 60);
        });

        test('a match at the very front of the chain is removed', async ({ page }) => {
            const colors = await page.evaluate(() => {
                startGame();
                setChain([0, 0, 1], 400);
                insertBall(0, 0);
                resolveMatches(0);
                return chain.balls.map((b) => b.color);
            });
            expect(colors).toEqual([1]);
        });

        test('clearing the leading marbles leaves the survivors where they were', async ({ page }) => {
            const { before, after } = await page.evaluate(() => {
                startGame();
                setChain([0, 0, 0, 1, 1], 400);
                const before = ballDist(3);       // first survivor
                resolveMatches(0);
                return { before, after: ballDist(0) };
            });
            expect(after).toBeCloseTo(before, 5);
        });

        test('the chain never reverses back behind the tunnel mouth', async ({ page }) => {
            const head = await page.evaluate(() => {
                startGame();
                setChain([0, 0, 0, 1], 10);
                resolveMatches(0);
                return chain.head;
            });
            expect(head).toBe(0);
        });

        test('a match at the very back of the chain is removed', async ({ page }) => {
            const colors = await page.evaluate(() => {
                startGame();
                setChain([1, 0, 0], 400);
                insertBall(3, 0);
                resolveMatches(3);
                return chain.balls.map((b) => b.color);
            });
            expect(colors).toEqual([1]);
        });
    });

    // -----------------------------------------------------------------------
    // Levels
    // -----------------------------------------------------------------------
    test.describe('levels', () => {
        test('clearing the chain with an empty queue advances the level', async ({ page }) => {
            const r = await page.evaluate(() => {
                startGame();
                spawnsRemaining = 0;
                setChain([0, 0], 400);
                insertBall(2, 0);
                resolveMatches(2);
                step(0.016);
                return { level, state, balls: chain.balls.length };
            });
            expect(r.level).toBe(2);
            expect(r.state).toBe('running');
        });

        test('clearing a level awards a bonus', async ({ page }) => {
            const s = await page.evaluate(() => {
                startGame();
                score = 0;
                spawnsRemaining = 0;
                chain.balls.length = 0;
                step(0.016);
                return score;
            });
            expect(s).toBeGreaterThan(0);
        });

        test('a new level refills the queue and resets the chain', async ({ page }) => {
            const r = await page.evaluate(() => {
                startGame();
                nextLevel();
                return { level, spawns: spawnsRemaining, balls: chain.balls.length, head: chain.head };
            });
            expect(r.level).toBe(2);
            expect(r.spawns).toBeGreaterThan(0);
            expect(r.balls).toBe(0);
            expect(r.head).toBeLessThan(50);
        });

        test('later levels release more marbles', async ({ page }) => {
            const { early, late } = await page.evaluate(() => {
                startGame();
                const early = spawnsRemaining;
                level = 5;
                nextLevel();
                return { early, late: spawnsRemaining };
            });
            expect(late).toBeGreaterThan(early);
        });

        test('the palette grows after the early levels', async ({ page }) => {
            const { first, later } = await page.evaluate(() => {
                startGame();
                const first = paletteSize();
                level = 4;
                return { first, later: paletteSize() };
            });
            expect(later).toBeGreaterThan(first);
            expect(later).toBeLessThanOrEqual(5);
        });

        test('a level is not cleared while marbles remain queued', async ({ page }) => {
            const lvl = await page.evaluate(() => {
                startGame();
                chain.balls.length = 0;
                spawnsRemaining = 5;
                step(0.016);
                return level;
            });
            expect(lvl).toBe(1);
        });
    });

    // -----------------------------------------------------------------------
    // Losing
    // -----------------------------------------------------------------------
    test.describe('losing', () => {
        test('the chain reaching the pit ends the game', async ({ page }) => {
            const s = await page.evaluate(() => {
                startGame();
                setChain([0, 1, 2], PATH_LENGTH - 1);
                for (let i = 0; i < 120; i++) step(0.016);
                return state;
            });
            expect(s).toBe('over');
        });

        test('game over shows the overlay with Play Again', async ({ page }) => {
            await page.evaluate(() => { startGame(); endGame(); });
            await expect(page.locator('#overlay')).toHaveClass(/visible/);
            await expect(page.locator('#btn-start')).toHaveText('Play Again');
        });

        test('the chain stops moving once the game is over', async ({ page }) => {
            const { before, after } = await page.evaluate(() => {
                startGame();
                setChain([0], 100);
                endGame();
                const before = chain.head;
                for (let i = 0; i < 30; i++) step(0.016);
                return { before, after: chain.head };
            });
            expect(after).toBe(before);
        });
    });

    // -----------------------------------------------------------------------
    // Scoring & best
    // -----------------------------------------------------------------------
    test.describe('scoring', () => {
        test('best score updates on game over when beaten', async ({ page }) => {
            await page.evaluate(() => { startGame(); score = 1234; updateHud(); endGame(); });
            await expect(page.locator('#best')).toHaveText('1234');
        });

        test('best score persists to localStorage', async ({ page }) => {
            await page.evaluate(() => { startGame(); score = 777; updateHud(); endGame(); });
            const stored = await page.evaluate(() => window.localStorage.getItem('marble-chain-best'));
            expect(parseInt(stored, 10)).toBe(777);
        });

        test('best score is not lowered by a worse run', async ({ page }) => {
            await page.evaluate(() => window.localStorage.setItem('marble-chain-best', '9000'));
            await page.reload();
            await page.evaluate(() => { startGame(); score = 5; updateHud(); endGame(); });
            await expect(page.locator('#best')).toHaveText('9000');
        });

        test('the HUD shows the running score', async ({ page }) => {
            await page.evaluate(() => { startGame(); score = 640; updateHud(); });
            await expect(page.locator('#score')).toHaveText('640');
        });

        test('the HUD shows how many marbles are left in the level', async ({ page }) => {
            await page.evaluate(() => {
                startGame();
                spawnsRemaining = 7;
                setChain([0, 1, 2], 200);
                updateHud();
            });
            await expect(page.locator('#remaining')).toHaveText('10');
        });
    });

    // -----------------------------------------------------------------------
    // Pause & restart
    // -----------------------------------------------------------------------
    test.describe('pause and restart', () => {
        test('pausing freezes the chain', async ({ page }) => {
            const { before, after } = await page.evaluate(() => {
                startGame();
                togglePause();
                const before = chain.head;
                for (let i = 0; i < 30; i++) step(0.016);
                return { before, after: chain.head };
            });
            expect(after).toBe(before);
        });

        test('resuming lets the chain move again', async ({ page }) => {
            const moved = await page.evaluate(() => {
                startGame();
                togglePause();
                togglePause();
                const before = chain.head;
                for (let i = 0; i < 30; i++) step(0.016);
                return chain.head > before;
            });
            expect(moved).toBe(true);
        });

        test('shooting does nothing while paused', async ({ page }) => {
            const n = await page.evaluate(() => {
                startGame();
                projectiles.length = 0;
                togglePause();
                shoot();
                return projectiles.length;
            });
            expect(n).toBe(0);
        });

        test('restart after game over resets score, level and the chain', async ({ page }) => {
            const r = await page.evaluate(() => {
                startGame();
                score = 999;
                level = 4;
                setChain([0, 1, 2], 500);
                spawnProjectile({ angle: 0, color: 0 });
                endGame();
                startGame();
                return { score, level, balls: chain.balls.length, projectiles: projectiles.length, state };
            });
            expect(r.score).toBe(0);
            expect(r.level).toBe(1);
            expect(r.balls).toBe(0);
            expect(r.projectiles).toBe(0);
            expect(r.state).toBe('running');
        });
    });

    // -----------------------------------------------------------------------
    // Keyboard & mouse wiring
    // -----------------------------------------------------------------------
    test.describe('controls', () => {
        test('ArrowRight rotates the turret', async ({ page }) => {
            await page.evaluate(() => { startGame(); setAim(0); });
            await page.keyboard.press('ArrowRight');
            expect(await page.evaluate(() => shooter.angle)).toBeGreaterThan(0);
        });

        test('ArrowLeft rotates the turret the other way', async ({ page }) => {
            await page.evaluate(() => { startGame(); setAim(0); });
            await page.keyboard.press('ArrowLeft');
            expect(await page.evaluate(() => shooter.angle)).toBeLessThan(0);
        });

        test('Space fires once the game is running', async ({ page }) => {
            await page.evaluate(() => { startGame(); projectiles.length = 0; });
            await page.keyboard.press('Space');
            // greater-than-zero rather than exactly one: the live loop may already
            // have flown the marble off the canvas by the time we look.
            expect(await page.evaluate(() => projectiles.length)).toBeGreaterThan(0);
        });

        test('P pauses and resumes', async ({ page }) => {
            await page.evaluate(() => startGame());
            await page.keyboard.press('p');
            expect(await page.evaluate(() => state)).toBe('paused');
            await page.keyboard.press('p');
            expect(await page.evaluate(() => state)).toBe('running');
        });

        test('S swaps the turret marbles', async ({ page }) => {
            // Both colours must be on the track, or the live game loop's restocking
            // pass will swap them out from under the test.
            await page.evaluate(() => {
                startGame();
                setChain([1, 2, 1, 2], 200);
                shooter.current = 1;
                shooter.next = 2;
            });
            await page.keyboard.press('s');
            const s = await page.evaluate(() => ({ cur: shooter.current, next: shooter.next }));
            expect(s.cur).toBe(2);
            expect(s.next).toBe(1);
        });

        test('moving the mouse aims the turret', async ({ page }) => {
            await page.evaluate(() => { startGame(); setAim(0); });
            const box = await page.locator('#canvas').boundingBox();
            await page.mouse.move(box.x + box.width / 2, box.y + 10);
            const angle = await page.evaluate(() => shooter.angle);
            expect(angle).toBeLessThan(-1);
        });

        test('clicking the canvas fires', async ({ page }) => {
            await page.evaluate(() => { startGame(); projectiles.length = 0; });
            const box = await page.locator('#canvas').boundingBox();
            await page.mouse.click(box.x + box.width / 2, box.y + 30);
            expect(await page.evaluate(() => projectiles.length)).toBeGreaterThan(0);
        });
    });

    // -----------------------------------------------------------------------
    // Rendering smoke test
    // -----------------------------------------------------------------------
    test.describe('rendering', () => {
        test('the canvas is not blank while playing', async ({ page }) => {
            const painted = await page.evaluate(() => {
                startGame();
                setChain([0, 1, 2, 3], 500);
                draw();
                const data = ctx.getImageData(0, 0, CANVAS_W, CANVAS_H).data;
                const first = [data[0], data[1], data[2]];
                for (let i = 4; i < data.length; i += 4) {
                    if (data[i] !== first[0] || data[i + 1] !== first[1] || data[i + 2] !== first[2]) return true;
                }
                return false;
            });
            expect(painted).toBe(true);
        });

        test('a full frame of play runs without throwing', async ({ page }) => {
            const errors = [];
            page.on('pageerror', (e) => errors.push(e.message));
            await page.evaluate(() => {
                startGame();
                for (let i = 0; i < 400; i++) {
                    step(0.016);
                    if (i % 40 === 0) shoot();
                    draw();
                }
            });
            expect(errors).toEqual([]);
        });
    });
});
