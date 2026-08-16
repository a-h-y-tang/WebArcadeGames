const { test, expect } = require('@playwright/test');
const path = require('path');
const { pathToFileURL } = require('url');

const GAME_URL = pathToFileURL(path.resolve(__dirname, '../index.html')).href;

test.describe('Curling', () => {
    test.beforeEach(async ({ page }) => {
        await page.goto(GAME_URL);
    });

    // -----------------------------------------------------------------------
    // Initial / idle state
    // -----------------------------------------------------------------------
    test.describe('initial state', () => {
        test('page title is Curling', async ({ page }) => {
            await expect(page).toHaveTitle('Curling');
        });

        test('canvas is 900x360', async ({ page }) => {
            const canvas = page.locator('#canvas');
            await expect(canvas).toHaveAttribute('width', '900');
            await expect(canvas).toHaveAttribute('height', '360');
        });

        test('start overlay is visible and prompts the player', async ({ page }) => {
            await expect(page.locator('#overlay')).toHaveClass(/visible/);
            await expect(page.locator('#overlay-sub')).toContainText(/space|start/i);
        });

        test('both scores start at 0', async ({ page }) => {
            await expect(page.locator('#score-p1')).toHaveText('0');
            await expect(page.locator('#score-p2')).toHaveText('0');
        });

        test('the end counter starts at 1', async ({ page }) => {
            await expect(page.locator('#end')).toHaveText('1');
        });

        test('state is idle before starting', async ({ page }) => {
            expect(await page.evaluate(() => state)).toBe('idle');
        });

        test('stepping while idle moves nothing', async ({ page }) => {
            const moved = await page.evaluate(() => {
                clearStones();
                const s = addStone('p1', 300, TEE_Y);
                s.vx = 200;
                for (let i = 0; i < 30; i++) step(0.016);
                return s.x !== 300;
            });
            expect(moved).toBe(false);
        });

        test('the sheet lines are laid out down the ice in order', async ({ page }) => {
            const g = await page.evaluate(() => ({
                hack: HACK_X, hog: HOG_X, tee: TEE_X, back: BACK_X,
                w: CANVAS_W, h: CANVAS_H, teeY: TEE_Y,
                top: SIDE_TOP, bottom: SIDE_BOTTOM,
            }));
            expect(g.hack).toBeLessThan(g.hog);
            expect(g.hog).toBeLessThan(g.tee);
            expect(g.tee).toBeLessThan(g.back);
            expect(g.back).toBeLessThan(g.w);
            expect(g.teeY).toBe(g.h / 2);
            expect(g.top).toBeLessThan(g.teeY);
            expect(g.bottom).toBeGreaterThan(g.teeY);
        });

        test('the house rings shrink toward the button', async ({ page }) => {
            const r = await page.evaluate(() => [HOUSE_R, RING_8, RING_4, BUTTON_R]);
            expect(r[0]).toBeGreaterThan(r[1]);
            expect(r[1]).toBeGreaterThan(r[2]);
            expect(r[2]).toBeGreaterThan(r[3]);
        });

        test('the page loads without console errors', async ({ page }) => {
            const errors = [];
            page.on('pageerror', (e) => errors.push(e.message));
            await page.reload();
            await page.waitForTimeout(300);
            expect(errors).toEqual([]);
        });
    });

    // -----------------------------------------------------------------------
    // Starting a match
    // -----------------------------------------------------------------------
    test.describe('starting a match', () => {
        test('Space starts the match and hides the overlay', async ({ page }) => {
            await page.keyboard.press('Space');
            expect(await page.evaluate(() => state)).toBe('running');
            await expect(page.locator('#overlay')).not.toHaveClass(/visible/);
        });

        test('the Start button starts the match', async ({ page }) => {
            await page.locator('#btn-start').click();
            expect(await page.evaluate(() => state)).toBe('running');
        });

        test('a fresh match is 0-0 in end 1 with four stones each', async ({ page }) => {
            const s = await page.evaluate(() => {
                startGame();
                return {
                    p1: scoreboard.p1, p2: scoreboard.p2, end: endNumber,
                    left1: stonesLeft.p1, left2: stonesLeft.p2, stones: stones.length,
                };
            });
            expect(s.p1).toBe(0);
            expect(s.p2).toBe(0);
            expect(s.end).toBe(1);
            expect(s.left1).toBe(4);
            expect(s.left2).toBe(4);
            expect(s.stones).toBe(0);
        });

        test('the rival holds the hammer first, so the player throws first', async ({ page }) => {
            const s = await page.evaluate(() => {
                startGame();
                return { turn, hammer, phase };
            });
            expect(s.hammer).toBe('p2');
            expect(s.turn).toBe('p1');
            expect(s.phase).toBe('aim');
        });

        test('the broom starts on the button with no handle set', async ({ page }) => {
            const a = await page.evaluate(() => {
                startGame();
                return { y: aim.y, spin: aim.spin, tee: TEE_Y };
            });
            expect(a.y).toBe(a.tee);
            expect(a.spin).toBe(0);
        });

        test('the canvas is painted after starting', async ({ page }) => {
            await page.keyboard.press('Space');
            await page.waitForTimeout(200);
            const painted = await page.evaluate(() => {
                const d = canvas.getContext('2d').getImageData(0, 0, CANVAS_W, CANVAS_H).data;
                for (let i = 0; i < d.length; i += 4) if (d[i + 3] !== 0) return true;
                return false;
            });
            expect(painted).toBe(true);
        });
    });

    // -----------------------------------------------------------------------
    // Aiming and delivering
    // -----------------------------------------------------------------------
    test.describe('aiming', () => {
        test('arrow up and down move the broom across the sheet', async ({ page }) => {
            await page.keyboard.press('Space');
            const start = await page.evaluate(() => aim.y);
            await page.keyboard.press('ArrowUp');
            const up = await page.evaluate(() => aim.y);
            expect(up).toBeLessThan(start);
            await page.keyboard.press('ArrowDown');
            await page.keyboard.press('ArrowDown');
            expect(await page.evaluate(() => aim.y)).toBeGreaterThan(up);
        });

        test('the broom cannot be aimed off the sheet', async ({ page }) => {
            const bounds = await page.evaluate(() => {
                startGame();
                for (let i = 0; i < 200; i++) aimBy(-10);
                const lo = aim.y;
                for (let i = 0; i < 400; i++) aimBy(10);
                return { lo, hi: aim.y, top: SIDE_TOP, bottom: SIDE_BOTTOM };
            });
            expect(bounds.lo).toBeGreaterThanOrEqual(bounds.top);
            expect(bounds.hi).toBeLessThanOrEqual(bounds.bottom);
        });

        test('left and right arrows set the handle', async ({ page }) => {
            await page.keyboard.press('Space');
            await page.keyboard.press('ArrowLeft');
            expect(await page.evaluate(() => aim.spin)).toBe(-1);
            await page.keyboard.press('ArrowRight');
            expect(await page.evaluate(() => aim.spin)).toBe(1);
        });

        test('moving the mouse over the sheet moves the broom', async ({ page }) => {
            await page.keyboard.press('Space');
            const box = await page.locator('#canvas').boundingBox();
            await page.mouse.move(box.x + box.width * 0.8, box.y + box.height * 0.25);
            const y = await page.evaluate(() => aim.y);
            expect(y).toBeLessThan(await page.evaluate(() => TEE_Y));
        });

        test('Space arms the power meter, and the meter swings', async ({ page }) => {
            await page.keyboard.press('Space');
            await page.keyboard.press('Space');
            expect(await page.evaluate(() => phase)).toBe('power');
            const moved = await page.evaluate(() => {
                const before = power;
                for (let i = 0; i < 20; i++) step(0.016);
                return power !== before;
            });
            expect(moved).toBe(true);
        });

        test('the power meter stays between 0 and 1', async ({ page }) => {
            const range = await page.evaluate(() => {
                startGame();
                armPower();
                let lo = 1, hi = 0;
                for (let i = 0; i < 600; i++) { step(0.016); lo = Math.min(lo, power); hi = Math.max(hi, power); }
                return { lo, hi };
            });
            expect(range.lo).toBeGreaterThanOrEqual(0);
            expect(range.hi).toBeLessThanOrEqual(1);
        });

        test('a second Space delivers the stone', async ({ page }) => {
            await page.keyboard.press('Space');
            await page.keyboard.press('Space');
            await page.waitForTimeout(120);
            await page.keyboard.press('Space');
            const s = await page.evaluate(() => ({
                phase, count: stones.length,
                speed: stones.length ? Math.hypot(stones[0].vx, stones[0].vy) : 0,
                team: stones.length ? stones[0].team : null,
                x: stones.length ? stones[0].x : 0,
                hack: HACK_X,
            }));
            expect(s.phase).toBe('slide');
            expect(s.count).toBe(1);
            expect(s.speed).toBeGreaterThan(0);
            expect(s.team).toBe('p1');
            // it has just left the hack and is still near the near end of the sheet
            expect(s.x).toBeGreaterThanOrEqual(s.hack);
            expect(s.x).toBeLessThan(s.hack + 80);
        });

        test('clicking the sheet also arms and delivers', async ({ page }) => {
            await page.keyboard.press('Space');
            await page.locator('#canvas').click();
            expect(await page.evaluate(() => phase)).toBe('power');
            await page.locator('#canvas').click();
            expect(await page.evaluate(() => phase)).toBe('slide');
        });

        test('a delivered stone belongs to the throwing team', async ({ page }) => {
            const teams = await page.evaluate(() => {
                startGame();
                const a = throwStone(0.5, TEE_Y, 0);
                clearStones();
                turn = 'p2';
                const b = throwStone(0.5, TEE_Y, 0);
                return [a.team, b.team];
            });
            expect(teams).toEqual(['p1', 'p2']);
        });

        test('more power means a faster stone', async ({ page }) => {
            const speeds = await page.evaluate(() => {
                startGame();
                const slow = throwStone(0.1, TEE_Y, 0);
                const fast = throwStone(0.9, TEE_Y, 0);
                return [Math.hypot(slow.vx, slow.vy), Math.hypot(fast.vx, fast.vy)];
            });
            expect(speeds[1]).toBeGreaterThan(speeds[0]);
        });
    });

    // -----------------------------------------------------------------------
    // Stone physics
    // -----------------------------------------------------------------------
    test.describe('physics', () => {
        test('a stone slows down under friction and comes to rest', async ({ page }) => {
            const r = await page.evaluate(() => {
                startGame();
                const s = throwStone(0.5, TEE_Y, 0);
                const v0 = Math.hypot(s.vx, s.vy);
                for (let i = 0; i < 60; i++) step(1 / 60);
                const v1 = Math.hypot(s.vx, s.vy);
                settle();
                return { v0, v1, v2: Math.hypot(s.vx, s.vy) };
            });
            expect(r.v1).toBeLessThan(r.v0);
            expect(r.v2).toBe(0);
        });

        test('a shot always settles in a bounded time', async ({ page }) => {
            const settled = await page.evaluate(() => {
                startGame();
                throwStone(1, TEE_Y, 0);
                settle();
                return phase !== 'slide' && stones.every((s) => s.vx === 0 && s.vy === 0);
            });
            expect(settled).toBe(true);
        });

        test('more power travels further down the sheet', async ({ page }) => {
            const xs = await page.evaluate(() => {
                const run = (power) => {
                    startGame();
                    clearStones();
                    const s = throwStone(power, TEE_Y, 0);
                    settle();
                    return s.x;
                };
                return [run(0.25), run(0.45)];
            });
            expect(xs[1]).toBeGreaterThan(xs[0]);
        });

        test('a right handle curls the stone toward the bottom of the sheet', async ({ page }) => {
            const y = await page.evaluate(() => {
                startGame();
                const s = throwStone(0.45, TEE_Y, 1);
                settle();
                return { end: s.y, tee: TEE_Y };
            });
            expect(y.end).toBeGreaterThan(y.tee + 2);
        });

        test('a left handle curls the stone toward the top of the sheet', async ({ page }) => {
            const y = await page.evaluate(() => {
                startGame();
                const s = throwStone(0.45, TEE_Y, -1);
                settle();
                return { end: s.y, tee: TEE_Y };
            });
            expect(y.end).toBeLessThan(y.tee - 2);
        });

        test('no handle runs the stone straight', async ({ page }) => {
            const drift = await page.evaluate(() => {
                startGame();
                const s = throwStone(0.45, TEE_Y, 0);
                settle();
                return Math.abs(s.y - TEE_Y);
            });
            expect(drift).toBeLessThan(1);
        });

        test('curl bends the stone more as it slows', async ({ page }) => {
            const bend = await page.evaluate(() => {
                startGame();
                const s = throwStone(0.45, TEE_Y, 1);
                let early = 0, late = 0, half = 0;
                const startY = s.y;
                // first half of the run, then the second half
                let t = 0;
                const total = 4;
                while (t < total / 2) { step(1 / 120); t += 1 / 120; }
                half = s.y - startY;
                settle();
                early = half;
                late = s.y - startY - half;
                return { early, late };
            });
            expect(bend.late).toBeGreaterThan(bend.early);
        });

        test('sweeping carries the stone further', async ({ page }) => {
            const xs = await page.evaluate(() => {
                const run = (sweep) => {
                    startGame();
                    clearStones();
                    const s = throwStone(0.4, TEE_Y, 0);
                    setSweeping(sweep);
                    settle();
                    setSweeping(false);
                    return s.x;
                };
                return { plain: run(false), swept: run(true) };
            });
            expect(xs.swept).toBeGreaterThan(xs.plain);
        });

        test('sweeping straightens the curl', async ({ page }) => {
            const ys = await page.evaluate(() => {
                const run = (sweep) => {
                    startGame();
                    clearStones();
                    const s = throwStone(0.4, TEE_Y, 1);
                    setSweeping(sweep);
                    settle();
                    setSweeping(false);
                    return s.y - TEE_Y;
                };
                return { plain: run(false), swept: run(true) };
            });
            expect(ys.swept).toBeLessThan(ys.plain);
        });

        test('the sweep budget drains while sweeping and then stops it', async ({ page }) => {
            const r = await page.evaluate(() => {
                startGame();
                throwStone(0.5, TEE_Y, 0);
                setSweeping(true);
                const before = sweepLeft;
                // one second of sweeping: some budget spent, broom still down
                for (let i = 0; i < 60; i++) step(1 / 60);
                const mid = { left: sweepLeft, sweeping };
                // ...and on until the budget is gone (this delivery only)
                let t = 1;
                while (phase === 'slide' && t < SWEEP_BUDGET + 1) { step(1 / 60); t += 1 / 60; }
                return { before, budget: SWEEP_BUDGET, mid, after: sweepLeft, sweeping };
            });
            expect(r.before).toBe(r.budget);
            expect(r.mid.left).toBeLessThan(r.before);
            expect(r.mid.left).toBeGreaterThan(0);
            expect(r.mid.sweeping).toBe(true);
            expect(r.after).toBe(0);
            expect(r.sweeping).toBe(false);
        });

        test('each delivery gets a fresh sweep budget', async ({ page }) => {
            const left = await page.evaluate(() => {
                startGame();
                throwStone(0.4, TEE_Y, 0);
                setSweeping(true);
                settle();
                turn = 'p1';
                phase = 'aim';
                throwStone(0.4, TEE_Y, 0);
                return { left: sweepLeft, budget: SWEEP_BUDGET };
            });
            expect(left.left).toBe(left.budget);
        });
    });

    // -----------------------------------------------------------------------
    // Boundaries
    // -----------------------------------------------------------------------
    test.describe('boundaries', () => {
        test('a delivered stone that stops short of the hog line is removed', async ({ page }) => {
            const r = await page.evaluate(() => {
                startGame();
                const s = throwStone(0.2, TEE_Y, 0);
                s.x = HOG_X - 40;
                s.vx = 0;
                s.vy = 0;
                settle();
                return { count: stones.length, left: stonesLeft.p1 };
            });
            expect(r.count).toBe(0);
            expect(r.left).toBe(3);
        });

        test('a stone knocked back behind the hog line stays in play', async ({ page }) => {
            const count = await page.evaluate(() => {
                startGame();
                clearStones();
                addStone('p2', HOG_X - 30, TEE_Y);
                const s = throwStone(0.4, TEE_Y, 0);
                s.x = HOG_X + 100;
                settle();
                return stones.filter((st) => st.team === 'p2').length;
            });
            expect(count).toBe(1);
        });

        test('a stone that runs past the back line is out of play', async ({ page }) => {
            const count = await page.evaluate(() => {
                startGame();
                throwStone(1, TEE_Y, 0);
                settle();
                return stones.length;
            });
            expect(count).toBe(0);
        });

        test('a stone that reaches a side line is out of play', async ({ page }) => {
            const count = await page.evaluate(() => {
                startGame();
                const s = throwStone(0.5, TEE_Y, 0);
                s.y = SIDE_TOP + STONE_R + 2;
                s.vy = -200;
                settle();
                return stones.length;
            });
            expect(count).toBe(0);
        });

        test('a stone resting inside the sheet stays in play', async ({ page }) => {
            const count = await page.evaluate(() => {
                startGame();
                throwStone(0.45, TEE_Y, 0);
                settle();
                return stones.length;
            });
            expect(count).toBe(1);
        });
    });

    // -----------------------------------------------------------------------
    // Collisions
    // -----------------------------------------------------------------------
    test.describe('collisions', () => {
        test('a take-out sends the stationary stone down the sheet', async ({ page }) => {
            const r = await page.evaluate(() => {
                startGame();
                clearStones();
                const target = addStone('p2', TEE_X, TEE_Y);
                const shooter = throwStone(0.75, TEE_Y, 0);
                settle();
                return { targetX: target.x, shooterX: shooter.x, tee: TEE_X, alive: stones.includes(target) };
            });
            expect(r.targetX).toBeGreaterThan(r.tee);
            expect(r.shooterX).toBeLessThan(r.targetX);
        });

        test('a head-on hit passes the speed to the target', async ({ page }) => {
            const r = await page.evaluate(() => {
                startGame();
                clearStones();
                const a = addStone('p1', 400, TEE_Y);
                const b = addStone('p2', 400 + STONE_R * 2 - 1, TEE_Y);
                a.vx = 200;
                resolveCollisions();
                return { avx: a.vx, bvx: b.vx };
            });
            expect(r.bvx).toBeCloseTo(200, 1);
            expect(r.avx).toBeCloseTo(0, 1);
        });

        test('momentum is conserved through a collision', async ({ page }) => {
            const r = await page.evaluate(() => {
                startGame();
                clearStones();
                const a = addStone('p1', 400, TEE_Y);
                const b = addStone('p2', 400 + STONE_R * 2 - 2, TEE_Y + 8);
                a.vx = 260;
                a.vy = 40;
                const before = { x: a.vx + b.vx, y: a.vy + b.vy };
                resolveCollisions();
                return { before, after: { x: a.vx + b.vx, y: a.vy + b.vy } };
            });
            expect(r.after.x).toBeCloseTo(r.before.x, 3);
            expect(r.after.y).toBeCloseTo(r.before.y, 3);
        });

        test('overlapping stones are pushed apart', async ({ page }) => {
            const gap = await page.evaluate(() => {
                startGame();
                clearStones();
                const a = addStone('p1', 400, TEE_Y);
                const b = addStone('p2', 405, TEE_Y);
                resolveCollisions();
                return Math.hypot(a.x - b.x, a.y - b.y);
            });
            expect(gap).toBeGreaterThanOrEqual(27.9);
        });

        test('stones never end an end overlapping', async ({ page }) => {
            const minGap = await page.evaluate(() => {
                startGame();
                clearStones();
                addStone('p2', TEE_X, TEE_Y);
                addStone('p2', TEE_X + 20, TEE_Y + 24);
                addStone('p1', TEE_X - 26, TEE_Y - 10);
                throwStone(0.7, TEE_Y, 0);
                settle();
                let m = Infinity;
                for (let i = 0; i < stones.length; i++) {
                    for (let j = i + 1; j < stones.length; j++) {
                        m = Math.min(m, Math.hypot(stones[i].x - stones[j].x, stones[i].y - stones[j].y));
                    }
                }
                return m;
            });
            expect(minGap).toBeGreaterThanOrEqual(27.9);
        });

        test('a stone knocked out of the sheet is removed', async ({ page }) => {
            const r = await page.evaluate(() => {
                startGame();
                clearStones();
                const target = addStone('p2', 500, SIDE_BOTTOM - STONE_R - 4);
                const shooter = addStone('p1', 494, target.y - STONE_R * 2 + 3);
                shooter.vx = 60;
                shooter.vy = 300;
                phase = 'slide';
                settle();
                return stones.includes(target);
            });
            expect(r).toBe(false);
        });
    });

    // -----------------------------------------------------------------------
    // Scoring
    // -----------------------------------------------------------------------
    test.describe('scoring an end', () => {
        test('the closest stone to the button scores', async ({ page }) => {
            const r = await page.evaluate(() => {
                startGame();
                clearStones();
                addStone('p1', TEE_X + 10, TEE_Y);
                addStone('p2', TEE_X + 60, TEE_Y);
                return computeEndScore();
            });
            expect(r).toEqual({ team: 'p1', points: 1 });
        });

        test('every stone closer than the best rival stone counts', async ({ page }) => {
            const r = await page.evaluate(() => {
                startGame();
                clearStones();
                addStone('p2', TEE_X + 5, TEE_Y);
                addStone('p2', TEE_X - 20, TEE_Y + 10);
                addStone('p2', TEE_X, TEE_Y + 40);
                addStone('p1', TEE_X, TEE_Y + 70);
                return computeEndScore();
            });
            expect(r).toEqual({ team: 'p2', points: 3 });
        });

        test('stones outside the house do not count', async ({ page }) => {
            const r = await page.evaluate(() => {
                startGame();
                clearStones();
                addStone('p1', TEE_X, TEE_Y);
                addStone('p1', HOG_X + 30, TEE_Y);
                return computeEndScore();
            });
            expect(r).toEqual({ team: 'p1', points: 1 });
        });

        test('a stone biting the rings still counts', async ({ page }) => {
            const r = await page.evaluate(() => {
                startGame();
                clearStones();
                addStone('p1', TEE_X + HOUSE_R + STONE_R - 2, TEE_Y);
                return computeEndScore();
            });
            expect(r.team).toBe('p1');
            expect(r.points).toBe(1);
        });

        test('an empty house is a blank end', async ({ page }) => {
            const r = await page.evaluate(() => {
                startGame();
                clearStones();
                addStone('p1', HOG_X + 40, TEE_Y);
                addStone('p2', HOG_X + 90, TEE_Y + 30);
                return computeEndScore();
            });
            expect(r).toEqual({ team: null, points: 0 });
        });

        test('distance to the button is measured from the tee', async ({ page }) => {
            const d = await page.evaluate(() => {
                startGame();
                clearStones();
                const s = addStone('p1', TEE_X + 30, TEE_Y + 40);
                return distanceToButton(s);
            });
            expect(d).toBeCloseTo(50, 5);
        });
    });

    // -----------------------------------------------------------------------
    // End and match flow
    // -----------------------------------------------------------------------
    test.describe('match flow', () => {
        test('teams alternate deliveries', async ({ page }) => {
            const turns = await page.evaluate(() => {
                startGame();
                const seen = [turn];
                throwStone(0.45, TEE_Y, 0);
                settle();
                seen.push(turn);
                return seen;
            });
            expect(turns).toEqual(['p1', 'p2']);
        });

        test('delivering uses up one of the team stones', async ({ page }) => {
            const left = await page.evaluate(() => {
                startGame();
                throwStone(0.45, TEE_Y, 0);
                settle();
                return { p1: stonesLeft.p1, p2: stonesLeft.p2 };
            });
            expect(left).toEqual({ p1: 3, p2: 4 });
        });

        test('the rival takes its own shot without the player', async ({ page }) => {
            const r = await page.evaluate(() => {
                startGame();
                throwStone(0.45, TEE_Y, 0);
                settle();          // player's stone; turn passes to the rival
                for (let i = 0; i < 60 * 20 && stonesLeft.p2 === 4; i++) step(1 / 60);
                return { left: stonesLeft.p2, turn };
            });
            expect(r.left).toBe(3);
            expect(r.turn).toBe('p1');
        });

        test('after eight stones the end is scored and the next end starts', async ({ page }) => {
            const r = await page.evaluate(() => {
                startGame();
                clearStones();
                addStone('p1', TEE_X + 8, TEE_Y);
                stonesLeft.p1 = 0;
                stonesLeft.p2 = 0;
                finishEnd();
                return {
                    end: endNumber, p1: scoreboard.p1, p2: scoreboard.p2,
                    stones: stones.length, left1: stonesLeft.p1, left2: stonesLeft.p2,
                    results: endResults.length,
                };
            });
            expect(r.end).toBe(2);
            expect(r.p1).toBe(1);
            expect(r.p2).toBe(0);
            expect(r.stones).toBe(0);
            expect(r.left1).toBe(4);
            expect(r.left2).toBe(4);
            expect(r.results).toBe(1);
        });

        test('the team that scores gives up the hammer', async ({ page }) => {
            const h = await page.evaluate(() => {
                startGame();
                hammer = 'p1';
                clearStones();
                addStone('p1', TEE_X, TEE_Y);
                stonesLeft.p1 = 0;
                stonesLeft.p2 = 0;
                finishEnd();
                return hammer;
            });
            expect(h).toBe('p2');
        });

        test('a blank end leaves the hammer where it was', async ({ page }) => {
            const h = await page.evaluate(() => {
                startGame();
                hammer = 'p1';
                clearStones();
                stonesLeft.p1 = 0;
                stonesLeft.p2 = 0;
                finishEnd();
                return { hammer, p1: scoreboard.p1, p2: scoreboard.p2 };
            });
            expect(h.hammer).toBe('p1');
            expect(h.p1).toBe(0);
            expect(h.p2).toBe(0);
        });

        test('the side without the hammer throws first in the new end', async ({ page }) => {
            const t = await page.evaluate(() => {
                startGame();
                hammer = 'p1';
                clearStones();
                stonesLeft.p1 = 0;
                stonesLeft.p2 = 0;
                finishEnd();
                return turn;
            });
            expect(t).toBe('p2');
        });

        test('the match ends after the last end', async ({ page }) => {
            const r = await page.evaluate(() => {
                startGame();
                endNumber = ENDS;
                clearStones();
                addStone('p1', TEE_X, TEE_Y);
                stonesLeft.p1 = 0;
                stonesLeft.p2 = 0;
                finishEnd();
                return { state, title: document.getElementById('overlay-title').textContent };
            });
            expect(r.state).toBe('over');
            expect(r.title).toMatch(/win/i);
        });

        test('the rival can win the match too', async ({ page }) => {
            const title = await page.evaluate(() => {
                startGame();
                endNumber = ENDS;
                clearStones();
                addStone('p2', TEE_X, TEE_Y);
                stonesLeft.p1 = 0;
                stonesLeft.p2 = 0;
                finishEnd();
                return document.getElementById('overlay-title').textContent;
            });
            expect(title).toMatch(/lose|rival/i);
        });

        test('an even match is reported as a tie', async ({ page }) => {
            const title = await page.evaluate(() => {
                startGame();
                endNumber = ENDS;
                clearStones();
                stonesLeft.p1 = 0;
                stonesLeft.p2 = 0;
                finishEnd();
                return document.getElementById('overlay-title').textContent;
            });
            expect(title).toMatch(/tie|draw/i);
        });

        test('a win is remembered in localStorage', async ({ page }) => {
            await page.evaluate(() => {
                window.localStorage.setItem('curling-wins', '2');
            });
            await page.reload();
            const wins = await page.evaluate(() => {
                startGame();
                endNumber = ENDS;
                clearStones();
                addStone('p1', TEE_X, TEE_Y);
                stonesLeft.p1 = 0;
                stonesLeft.p2 = 0;
                finishEnd();
                return window.localStorage.getItem('curling-wins');
            });
            expect(wins).toBe('3');
        });

        test('a full match can be played out to a result', async ({ page }) => {
            const r = await page.evaluate(() => {
                startGame();
                for (let i = 0; i < 60 * 400 && state === 'running'; i++) {
                    if (phase === 'aim') throwStone(0.55 + (stonesLeft.p1 % 3) * 0.03, TEE_Y + (stonesLeft.p1 - 2) * 12, stonesLeft.p1 % 2 ? 1 : -1);
                    step(1 / 60);
                }
                return { state, end: endNumber, p1: scoreboard.p1, p2: scoreboard.p2, results: endResults.length };
            });
            expect(r.state).toBe('over');
            expect(r.results).toBe(await page.evaluate(() => ENDS));
            expect(r.p1 + r.p2).toBeGreaterThan(0);
        });
    });

    // -----------------------------------------------------------------------
    // HUD, pausing and restarting
    // -----------------------------------------------------------------------
    test.describe('interface', () => {
        test('the HUD shows the running score and end', async ({ page }) => {
            await page.evaluate(() => {
                startGame();
                clearStones();
                addStone('p2', TEE_X, TEE_Y);
                addStone('p2', TEE_X + 20, TEE_Y);
                stonesLeft.p1 = 0;
                stonesLeft.p2 = 0;
                finishEnd();
            });
            await expect(page.locator('#score-p2')).toHaveText('2');
            await expect(page.locator('#score-p1')).toHaveText('0');
            await expect(page.locator('#end')).toHaveText('2');
        });

        test('the HUD shows how many stones are left', async ({ page }) => {
            await page.evaluate(() => {
                startGame();
                throwStone(0.45, TEE_Y, 0);
                settle();
            });
            await expect(page.locator('#stones-p1')).toHaveText('3');
            await expect(page.locator('#stones-p2')).toHaveText('4');
        });

        test('the HUD shows who holds the hammer', async ({ page }) => {
            await page.keyboard.press('Space');
            await expect(page.locator('#hammer')).toContainText(/rival/i);
        });

        test('P pauses and resumes the match', async ({ page }) => {
            await page.keyboard.press('Space');
            await page.keyboard.press('KeyP');
            expect(await page.evaluate(() => state)).toBe('paused');
            await expect(page.locator('#overlay')).toHaveClass(/visible/);
            await page.keyboard.press('KeyP');
            expect(await page.evaluate(() => state)).toBe('running');
            await expect(page.locator('#overlay')).not.toHaveClass(/visible/);
        });

        test('a paused match does not move stones', async ({ page }) => {
            const moved = await page.evaluate(() => {
                startGame();
                const s = throwStone(0.5, TEE_Y, 0);
                togglePause();
                const x = s.x;
                for (let i = 0; i < 60; i++) step(1 / 60);
                return s.x !== x;
            });
            expect(moved).toBe(false);
        });

        test('the match can be restarted after it is over', async ({ page }) => {
            const r = await page.evaluate(() => {
                startGame();
                endNumber = ENDS;
                clearStones();
                addStone('p1', TEE_X, TEE_Y);
                stonesLeft.p1 = 0;
                stonesLeft.p2 = 0;
                finishEnd();
                startGame();
                return { state, end: endNumber, p1: scoreboard.p1, p2: scoreboard.p2, results: endResults.length };
            });
            expect(r.state).toBe('running');
            expect(r.end).toBe(1);
            expect(r.p1).toBe(0);
            expect(r.p2).toBe(0);
            expect(r.results).toBe(0);
        });

        test('the line score records each end', async ({ page }) => {
            await page.evaluate(() => {
                startGame();
                clearStones();
                addStone('p1', TEE_X, TEE_Y);
                stonesLeft.p1 = 0;
                stonesLeft.p2 = 0;
                finishEnd();
            });
            await expect(page.locator('#linescore')).toContainText('1');
        });
    });
});
