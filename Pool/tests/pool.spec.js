const { test, expect } = require('@playwright/test');
const path = require('path');
const { pathToFileURL } = require('url');

const GAME_URL = pathToFileURL(path.resolve(__dirname, '../index.html')).href;

/** Run the simulation until every ball has come to rest (or we give up). */
async function settle(page) {
    await page.evaluate(() => {
        for (let i = 0; i < 8000 && (state === 'rolling' || ballsMoving()); i++) {
            step(1 / 120);
        }
    });
}

/** Clear the table and place only the given balls (plus the cue). */
async function setTable(page, layout) {
    await page.evaluate((spec) => {
        startGame();
        aiEnabled = false;
        balls.forEach((b) => {
            if (b.n === 0) return;
            b.potted = true;
            b.vx = 0;
            b.vy = 0;
            b.x = -100;
            b.y = -100;
        });
        spec.balls.forEach((s) => {
            const b = balls.find((bb) => bb.n === s.n);
            b.potted = false;
            b.x = s.x;
            b.y = s.y;
            b.vx = 0;
            b.vy = 0;
        });
        const cue = balls[0];
        cue.potted = false;
        cue.x = spec.cue.x;
        cue.y = spec.cue.y;
        cue.vx = 0;
        cue.vy = 0;
        if (spec.groups) {
            groups[1] = spec.groups[1];
            groups[2] = spec.groups[2];
        }
        if (spec.player) currentPlayer = spec.player;
        state = 'aiming';
        updateHud();
    }, layout);
}

test.describe('8-Ball Pool', () => {
    test.beforeEach(async ({ page }) => {
        await page.goto(GAME_URL);
    });

    // -----------------------------------------------------------------------
    // Initial state
    // -----------------------------------------------------------------------
    test.describe('initial state', () => {
        test('page title is 8-Ball Pool', async ({ page }) => {
            await expect(page).toHaveTitle('8-Ball Pool');
        });

        test('start overlay is visible and prompts the player', async ({ page }) => {
            await expect(page.locator('#overlay')).toHaveClass(/visible/);
            await expect(page.locator('#overlay-sub')).toContainText(/space|start/i);
        });

        test('canvas is 880x480', async ({ page }) => {
            const canvas = page.locator('#canvas');
            await expect(canvas).toHaveAttribute('width', '880');
            await expect(canvas).toHaveAttribute('height', '480');
        });

        test('state is idle before starting', async ({ page }) => {
            expect(await page.evaluate(() => state)).toBe('idle');
        });

        test('there are 16 balls, none potted', async ({ page }) => {
            const info = await page.evaluate(() => ({
                count: balls.length,
                potted: balls.filter((b) => b.potted).length,
                numbers: balls.map((b) => b.n).sort((a, b) => a - b),
            }));
            expect(info.count).toBe(16);
            expect(info.potted).toBe(0);
            expect(info.numbers).toEqual([...Array(16).keys()]);
        });

        test('ball types are 7 solids, 7 stripes, an eight and a cue', async ({ page }) => {
            const types = await page.evaluate(() =>
                balls.reduce((acc, b) => {
                    acc[b.type] = (acc[b.type] || 0) + 1;
                    return acc;
                }, {})
            );
            expect(types).toEqual({ cue: 1, solid: 7, stripe: 7, eight: 1 });
        });

        test('the cue ball sits on the head spot', async ({ page }) => {
            const cue = await page.evaluate(() => ({
                x: balls[0].x,
                y: balls[0].y,
                n: balls[0].n,
                headX: PLAY_L + (PLAY_R - PLAY_L) * 0.25,
                midY: (PLAY_T + PLAY_B) / 2,
            }));
            expect(cue.n).toBe(0);
            expect(cue.x).toBeCloseTo(cue.headX, 0);
            expect(cue.y).toBeCloseTo(cue.midY, 0);
        });

        test('racked balls do not overlap each other', async ({ page }) => {
            const worst = await page.evaluate(() => {
                let min = Infinity;
                for (let i = 0; i < balls.length; i++) {
                    for (let j = i + 1; j < balls.length; j++) {
                        const d = Math.hypot(balls[i].x - balls[j].x, balls[i].y - balls[j].y);
                        min = Math.min(min, d);
                    }
                }
                return { min, diameter: BALL_R * 2 };
            });
            expect(worst.min).toBeGreaterThanOrEqual(worst.diameter);
        });

        test('every ball starts inside the playfield', async ({ page }) => {
            const ok = await page.evaluate(() =>
                balls.every(
                    (b) =>
                        b.x >= PLAY_L + BALL_R &&
                        b.x <= PLAY_R - BALL_R &&
                        b.y >= PLAY_T + BALL_R &&
                        b.y <= PLAY_B - BALL_R
                )
            );
            expect(ok).toBe(true);
        });

        test('the 8-ball is in the middle of the rack', async ({ page }) => {
            const eight = await page.evaluate(() => {
                const b = balls.find((bb) => bb.n === 8);
                return { x: b.x, y: b.y, centerY: (PLAY_T + PLAY_B) / 2 };
            });
            expect(eight.y).toBeCloseTo(eight.centerY, 0);
        });

        test('there are six pockets on the playfield corners and long-rail middles', async ({ page }) => {
            const p = await page.evaluate(() => ({
                pockets: POCKETS.map((k) => [k.x, k.y]),
                l: PLAY_L, r: PLAY_R, t: PLAY_T, b: PLAY_B,
            }));
            expect(p.pockets).toHaveLength(6);
            const mid = (p.l + p.r) / 2;
            expect(p.pockets).toEqual(
                expect.arrayContaining([
                    [p.l, p.t], [mid, p.t], [p.r, p.t],
                    [p.l, p.b], [mid, p.b], [p.r, p.b],
                ])
            );
        });

        test('stepping while idle does nothing', async ({ page }) => {
            const moved = await page.evaluate(() => {
                balls[0].vx = 400;
                const before = balls[0].x;
                for (let i = 0; i < 30; i++) step(1 / 60);
                return balls[0].x !== before;
            });
            expect(moved).toBe(false);
        });

        test('player 1 is up with no group assigned', async ({ page }) => {
            const s = await page.evaluate(() => ({ p: currentPlayer, g1: groups[1], g2: groups[2] }));
            expect(s).toEqual({ p: 1, g1: null, g2: null });
        });
    });

    // -----------------------------------------------------------------------
    // Starting / restarting
    // -----------------------------------------------------------------------
    test.describe('starting', () => {
        test('Space starts the game', async ({ page }) => {
            await page.keyboard.press('Space');
            expect(await page.evaluate(() => state)).toBe('aiming');
            await expect(page.locator('#overlay')).not.toHaveClass(/visible/);
        });

        test('the Start button starts the game', async ({ page }) => {
            await page.locator('#btn-start').click();
            expect(await page.evaluate(() => state)).toBe('aiming');
        });

        test('a new game re-racks the table', async ({ page }) => {
            const same = await page.evaluate(() => {
                startGame();
                const before = balls.map((b) => [b.x, b.y]);
                shoot(0, 1);
                for (let i = 0; i < 2000 && (state === 'rolling' || ballsMoving()); i++) step(1 / 120);
                startGame();
                const after = balls.map((b) => [b.x, b.y]);
                return JSON.stringify(before) === JSON.stringify(after);
            });
            expect(same).toBe(true);
        });

        test('R starts a new game mid-play', async ({ page }) => {
            await page.evaluate(() => {
                startGame();
                aiEnabled = false;
                balls[3].potted = true;
                currentPlayer = 2;
            });
            await page.keyboard.press('r');
            const s = await page.evaluate(() => ({
                potted: balls.filter((b) => b.potted).length,
                player: currentPlayer,
                state,
            }));
            expect(s).toEqual({ potted: 0, player: 1, state: 'aiming' });
        });
    });

    // -----------------------------------------------------------------------
    // Physics
    // -----------------------------------------------------------------------
    test.describe('physics', () => {
        test('friction brings a rolling ball to a complete stop', async ({ page }) => {
            const res = await page.evaluate(() => {
                startGame();
                aiEnabled = false;
                const cue = balls[0];
                cue.vx = 300;
                cue.vy = 0;
                state = 'rolling';
                for (let i = 0; i < 2000 && ballsMoving(); i++) step(1 / 120);
                return { vx: cue.vx, vy: cue.vy, moving: ballsMoving() };
            });
            expect(res.moving).toBe(false);
            expect(res.vx).toBe(0);
            expect(res.vy).toBe(0);
        });

        test('a harder shot rolls further', async ({ page }) => {
            const d = await page.evaluate(() => {
                const roll = (speed) => {
                    startGame();
                    aiEnabled = false;
                    balls.forEach((b, i) => { if (i > 0) b.potted = true; });
                    const cue = balls[0];
                    cue.x = 100;
                    cue.y = 240;
                    cue.vx = 0;
                    cue.vy = 0;
                    state = 'rolling';
                    cue.vx = speed;
                    for (let i = 0; i < 4000 && ballsMoving(); i++) step(1 / 120);
                    return cue.x;
                };
                const soft = roll(200);
                const hard = roll(500);
                return { soft, hard };
            });
            expect(d.hard).toBeGreaterThan(d.soft + 50);
        });

        test('a ball bounces off the left and right cushions', async ({ page }) => {
            const res = await setTable(page, { cue: { x: 200, y: 240 }, balls: [] }).then(() =>
                page.evaluate(() => {
                    const cue = balls[0];
                    cue.vx = -600;
                    state = 'rolling';
                    for (let i = 0; i < 400 && cue.vx < 0; i++) step(1 / 240);
                    return { vx: cue.vx, x: cue.x };
                })
            );
            expect(res.vx).toBeGreaterThan(0);
            expect(res.x).toBeGreaterThan(0);
        });

        test('a ball bounces off the top cushion', async ({ page }) => {
            await setTable(page, { cue: { x: 300, y: 240 }, balls: [] });
            const res = await page.evaluate(() => {
                const cue = balls[0];
                cue.vy = -600;
                state = 'rolling';
                for (let i = 0; i < 400 && cue.vy < 0; i++) step(1 / 240);
                return { vy: cue.vy, y: cue.y };
            });
            expect(res.vy).toBeGreaterThan(0);
        });

        test('a cushion bounce loses some energy', async ({ page }) => {
            await setTable(page, { cue: { x: 300, y: 240 }, balls: [] });
            const res = await page.evaluate(() => {
                const cue = balls[0];
                cue.vy = -600;
                state = 'rolling';
                for (let i = 0; i < 400 && cue.vy < 0; i++) step(1 / 240);
                return Math.abs(cue.vy);
            });
            expect(res).toBeLessThan(600);
        });

        test('balls never escape the playfield, even at high speed', async ({ page }) => {
            await setTable(page, { cue: { x: 300, y: 240 }, balls: [{ n: 1, x: 500, y: 250 }] });
            const escaped = await page.evaluate(() => {
                balls[0].vx = 2400;
                balls[0].vy = 1700;
                state = 'rolling';
                let bad = false;
                for (let i = 0; i < 3000 && ballsMoving(); i++) {
                    step(1 / 240);
                    for (const b of balls) {
                        if (b.potted) continue;
                        if (b.x < PLAY_L - 0.5 || b.x > PLAY_R + 0.5) bad = true;
                        if (b.y < PLAY_T - 0.5 || b.y > PLAY_B + 0.5) bad = true;
                    }
                }
                return bad;
            });
            expect(escaped).toBe(false);
        });

        test('a head-on collision passes the speed to the struck ball', async ({ page }) => {
            await setTable(page, { cue: { x: 200, y: 240 }, balls: [{ n: 1, x: 400, y: 240 }] });
            const res = await page.evaluate(() => {
                balls[0].vx = 600;
                state = 'rolling';
                for (let i = 0; i < 400 && balls[1].vx === 0; i++) step(1 / 240);
                return { cueVx: balls[0].vx, objVx: balls[1].vx };
            });
            expect(res.objVx).toBeGreaterThan(400);
            expect(Math.abs(res.cueVx)).toBeLessThan(60);
        });

        test('a collision roughly conserves momentum', async ({ page }) => {
            await setTable(page, { cue: { x: 200, y: 240 }, balls: [{ n: 1, x: 400, y: 252 }] });
            const res = await page.evaluate(() => {
                balls[0].vx = 800;
                state = 'rolling';
                const before = 800;
                for (let i = 0; i < 200 && balls[1].vx === 0 && balls[1].vy === 0; i++) step(1 / 480);
                step(1 / 480);
                return { before, after: balls[0].vx + balls[1].vx };
            });
            expect(res.after).toBeGreaterThan(res.before * 0.8);
            expect(res.after).toBeLessThan(res.before * 1.05);
        });

        test('a cut shot sends the object ball off at an angle', async ({ page }) => {
            await setTable(page, { cue: { x: 200, y: 240 }, balls: [{ n: 1, x: 400, y: 254 }] });
            const res = await page.evaluate(() => {
                balls[0].vx = 700;
                state = 'rolling';
                for (let i = 0; i < 400 && balls[1].vx === 0 && balls[1].vy === 0; i++) step(1 / 240);
                return { vx: balls[1].vx, vy: balls[1].vy };
            });
            expect(res.vx).toBeGreaterThan(0);
            expect(res.vy).toBeGreaterThan(0);
        });

        test('overlapping balls are pushed apart', async ({ page }) => {
            await setTable(page, { cue: { x: 300, y: 240 }, balls: [{ n: 1, x: 305, y: 240 }] });
            const gap = await page.evaluate(() => {
                state = 'rolling';
                balls[0].vx = 1;
                for (let i = 0; i < 60; i++) step(1 / 240);
                return Math.hypot(balls[0].x - balls[1].x, balls[0].y - balls[1].y);
            });
            expect(gap).toBeGreaterThanOrEqual(21.5);
        });

        test('fast balls do not tunnel through each other', async ({ page }) => {
            await setTable(page, { cue: { x: 100, y: 240 }, balls: [{ n: 1, x: 700, y: 240 }] });
            const hit = await page.evaluate(() => {
                balls[0].vx = 3000;
                state = 'rolling';
                for (let i = 0; i < 4000 && (state === 'rolling' || ballsMoving()); i++) step(1 / 120);
                return shotInfo.firstContact;
            });
            expect(hit).toBe(1);
        });

        test('the simulation is deterministic', async ({ page }) => {
            const same = await page.evaluate(() => {
                const run = () => {
                    startGame();
                    aiEnabled = false;
                    shoot(Math.PI / 7, 0.9);
                    for (let i = 0; i < 5000 && (state === 'rolling' || ballsMoving()); i++) step(1 / 120);
                    return balls.map((b) => [Math.round(b.x * 1e6), Math.round(b.y * 1e6)]);
                };
                return JSON.stringify(run()) === JSON.stringify(run());
            });
            expect(same).toBe(true);
        });
    });

    // -----------------------------------------------------------------------
    // Pockets
    // -----------------------------------------------------------------------
    test.describe('pockets', () => {
        test('a ball rolled into a corner pocket is potted and leaves the table', async ({ page }) => {
            await setTable(page, { cue: { x: 300, y: 240 }, balls: [{ n: 1, x: 700, y: 300 }] });
            const res = await page.evaluate(() => {
                const b = balls[1];
                const dx = PLAY_R - b.x;
                const dy = PLAY_B - b.y;
                const len = Math.hypot(dx, dy);
                b.vx = (dx / len) * 500;
                b.vy = (dy / len) * 500;
                state = 'rolling';
                for (let i = 0; i < 3000 && (state === 'rolling' || ballsMoving()); i++) step(1 / 240);
                return { potted: b.potted, vx: b.vx, vy: b.vy, potted1: shotInfo.potted.includes(1) };
            });
            expect(res.potted).toBe(true);
            expect(res.vx).toBe(0);
            expect(res.vy).toBe(0);
            expect(res.potted1).toBe(true);
        });

        test('a ball rolled into a side pocket is potted', async ({ page }) => {
            await setTable(page, { cue: { x: 300, y: 240 }, balls: [{ n: 1, x: 440, y: 300 }] });
            const potted = await page.evaluate(() => {
                balls[1].vy = -500;
                state = 'rolling';
                for (let i = 0; i < 3000 && (state === 'rolling' || ballsMoving()); i++) step(1 / 240);
                return balls[1].potted;
            });
            expect(potted).toBe(true);
        });

        test('potting the cue ball records a scratch', async ({ page }) => {
            await setTable(page, { cue: { x: 700, y: 300 }, balls: [{ n: 1, x: 200, y: 100 }] });
            const res = await page.evaluate(() => {
                const dx = PLAY_R - balls[0].x;
                const dy = PLAY_B - balls[0].y;
                const len = Math.hypot(dx, dy);
                shoot(Math.atan2(dy, dx), 0.5);
                for (let i = 0; i < 5000 && (state === 'rolling' || ballsMoving()); i++) step(1 / 120);
                return { cuePotted: lastShot.cuePotted, len };
            });
            expect(res.cuePotted).toBe(true);
        });
    });

    // -----------------------------------------------------------------------
    // Shooting
    // -----------------------------------------------------------------------
    test.describe('shooting', () => {
        test('shoot sends the cue ball along the given angle', async ({ page }) => {
            await page.evaluate(() => {
                startGame();
                aiEnabled = false;
                shoot(Math.PI / 2, 1);
            });
            const v = await page.evaluate(() => ({ vx: balls[0].vx, vy: balls[0].vy, state }));
            expect(v.state).toBe('rolling');
            expect(Math.abs(v.vx)).toBeLessThan(1e-6);
            expect(v.vy).toBeGreaterThan(0);
        });

        test('shoot power scales the cue speed', async ({ page }) => {
            const speeds = await page.evaluate(() => {
                const s = (p) => {
                    startGame();
                    aiEnabled = false;
                    shoot(0, p);
                    return Math.hypot(balls[0].vx, balls[0].vy);
                };
                return { low: s(0.2), high: s(1), max: MAX_SHOT_SPEED, min: MIN_SHOT_SPEED };
            });
            expect(speeds.high).toBeGreaterThan(speeds.low);
            expect(speeds.low).toBeGreaterThanOrEqual(speeds.min);
            expect(speeds.high).toBeCloseTo(speeds.max, 6);
        });

        test('shoot is ignored while the balls are rolling', async ({ page }) => {
            const res = await page.evaluate(() => {
                startGame();
                aiEnabled = false;
                shoot(0, 1);
                const before = { vx: balls[0].vx, vy: balls[0].vy };
                const accepted = shoot(Math.PI, 1);
                return { accepted, before, after: { vx: balls[0].vx, vy: balls[0].vy } };
            });
            expect(res.accepted).toBe(false);
            expect(res.after).toEqual(res.before);
        });

        test('the balls settle back into an aiming state', async ({ page }) => {
            await page.evaluate(() => {
                startGame();
                aiEnabled = false;
                shoot(0, 1);
            });
            await settle(page);
            const s = await page.evaluate(() => state);
            expect(['aiming', 'ballinhand', 'gameover']).toContain(s);
        });

        test('the break scatters the rack', async ({ page }) => {
            await page.evaluate(() => {
                startGame();
                aiEnabled = false;
            });
            const before = await page.evaluate(() => balls.map((b) => ({ x: b.x, y: b.y })));
            await page.evaluate(() => shoot(0, 1));
            await settle(page);
            const moved = await page.evaluate(
                (prev) =>
                    balls.filter(
                        (b, i) => b.potted || Math.hypot(b.x - prev[i].x, b.y - prev[i].y) > 20
                    ).length,
                before
            );
            expect(moved).toBeGreaterThanOrEqual(5);
        });
    });

    // -----------------------------------------------------------------------
    // Rules
    // -----------------------------------------------------------------------
    test.describe('rules', () => {
        test('the first legal pot assigns the groups', async ({ page }) => {
            await setTable(page, { cue: { x: 300, y: 240 }, balls: [{ n: 3, x: 700, y: 300 }] });
            const res = await page.evaluate(() => {
                const b = balls.find((x) => x.n === 3);
                const ang = Math.atan2(PLAY_B - 21 - b.y, PLAY_R - 21 - b.x);
                balls[0].x = b.x - Math.cos(ang) * 40;
                balls[0].y = b.y - Math.sin(ang) * 40;
                shoot(ang, 0.55);
                for (let i = 0; i < 6000 && (state === 'rolling' || ballsMoving()); i++) step(1 / 120);
                return { g1: groups[1], g2: groups[2], potted: b.potted, player: currentPlayer };
            });
            expect(res.potted).toBe(true);
            expect(res.g1).toBe('solid');
            expect(res.g2).toBe('stripe');
            expect(res.player).toBe(1);
        });

        test('potting one of your own balls keeps your turn', async ({ page }) => {
            await setTable(page, {
                cue: { x: 300, y: 240 },
                balls: [{ n: 2, x: 700, y: 300 }, { n: 10, x: 200, y: 400 }],
                groups: { 1: 'solid', 2: 'stripe' },
                player: 1,
            });
            const res = await page.evaluate(() => {
                const b = balls.find((x) => x.n === 2);
                const ang = Math.atan2(PLAY_B - 21 - b.y, PLAY_R - 21 - b.x);
                balls[0].x = b.x - Math.cos(ang) * 40;
                balls[0].y = b.y - Math.sin(ang) * 40;
                shoot(ang, 0.55);
                for (let i = 0; i < 6000 && (state === 'rolling' || ballsMoving()); i++) step(1 / 120);
                return { potted: b.potted, player: currentPlayer, state };
            });
            expect(res.potted).toBe(true);
            expect(res.player).toBe(1);
            expect(res.state).toBe('aiming');
        });

        test('potting nothing passes the turn', async ({ page }) => {
            await setTable(page, {
                cue: { x: 300, y: 240 },
                balls: [{ n: 2, x: 400, y: 240 }],
                groups: { 1: 'solid', 2: 'stripe' },
                player: 1,
            });
            await page.evaluate(() => shoot(0, 0.25));
            await settle(page);
            const res = await page.evaluate(() => ({ player: currentPlayer, state, potted: balls[2].potted }));
            expect(res.player).toBe(2);
            expect(res.state).toBe('aiming');
        });

        test('a scratch is a foul and gives the opponent ball in hand', async ({ page }) => {
            await setTable(page, {
                cue: { x: 700, y: 300 },
                balls: [{ n: 2, x: 690, y: 200 }],
                groups: { 1: 'solid', 2: 'stripe' },
                player: 1,
            });
            await page.evaluate(() => {
                const ang = Math.atan2(PLAY_B - balls[0].y, PLAY_R - balls[0].x);
                shoot(ang, 0.5);
            });
            await settle(page);
            const res = await page.evaluate(() => ({
                player: currentPlayer,
                state,
                cuePotted: balls[0].potted,
                foul: lastShot.foul,
            }));
            expect(res.foul).toBe(true);
            expect(res.player).toBe(2);
            expect(res.state).toBe('ballinhand');
        });

        test('hitting nothing at all is a foul', async ({ page }) => {
            await setTable(page, {
                cue: { x: 300, y: 240 },
                balls: [{ n: 2, x: 300, y: 100 }],
                groups: { 1: 'solid', 2: 'stripe' },
                player: 1,
            });
            await page.evaluate(() => shoot(0, 0.15));
            await settle(page);
            const res = await page.evaluate(() => ({
                foul: lastShot.foul,
                first: lastShot.firstContact,
                player: currentPlayer,
                state,
            }));
            expect(res.first).toBe(null);
            expect(res.foul).toBe(true);
            expect(res.player).toBe(2);
            expect(res.state).toBe('ballinhand');
        });

        test("hitting the opponent's ball first is a foul", async ({ page }) => {
            await setTable(page, {
                cue: { x: 300, y: 240 },
                balls: [{ n: 10, x: 420, y: 240 }, { n: 2, x: 300, y: 400 }],
                groups: { 1: 'solid', 2: 'stripe' },
                player: 1,
            });
            await page.evaluate(() => shoot(0, 0.3));
            await settle(page);
            const res = await page.evaluate(() => ({
                first: lastShot.firstContact,
                foul: lastShot.foul,
                player: currentPlayer,
            }));
            expect(res.first).toBe(10);
            expect(res.foul).toBe(true);
            expect(res.player).toBe(2);
        });

        test('hitting the 8-ball first while your group is still on is a foul', async ({ page }) => {
            await setTable(page, {
                cue: { x: 300, y: 240 },
                balls: [{ n: 8, x: 420, y: 240 }, { n: 2, x: 300, y: 400 }],
                groups: { 1: 'solid', 2: 'stripe' },
                player: 1,
            });
            await page.evaluate(() => shoot(0, 0.25));
            await settle(page);
            const res = await page.evaluate(() => ({ first: lastShot.firstContact, foul: lastShot.foul }));
            expect(res.first).toBe(8);
            expect(res.foul).toBe(true);
        });

        test('hitting the 8-ball first is legal once your group is cleared', async ({ page }) => {
            await setTable(page, {
                cue: { x: 300, y: 240 },
                balls: [{ n: 8, x: 420, y: 240 }],
                groups: { 1: 'solid', 2: 'stripe' },
                player: 1,
            });
            await page.evaluate(() => shoot(0, 0.2));
            await settle(page);
            const res = await page.evaluate(() => ({ first: lastShot.firstContact, foul: lastShot.foul }));
            expect(res.first).toBe(8);
            expect(res.foul).toBe(false);
        });

        test("potting only the opponent's ball is legal but passes the turn", async ({ page }) => {
            await setTable(page, {
                cue: { x: 300, y: 240 },
                balls: [{ n: 2, x: 500, y: 240 }, { n: 10, x: 700, y: 300 }],
                groups: { 1: 'solid', 2: 'stripe' },
                player: 1,
            });
            const res = await page.evaluate(() => {
                const target = balls.find((b) => b.n === 10);
                const two = balls.find((b) => b.n === 2);
                const ang = Math.atan2(PLAY_B - 21 - target.y, PLAY_R - 21 - target.x);
                // Line the cue up on the 2, and the 2 up on the 10 → 10 goes in.
                two.x = target.x - Math.cos(ang) * 24;
                two.y = target.y - Math.sin(ang) * 24;
                balls[0].x = two.x - Math.cos(ang) * 60;
                balls[0].y = two.y - Math.sin(ang) * 60;
                shoot(ang, 0.7);
                for (let i = 0; i < 6000 && (state === 'rolling' || ballsMoving()); i++) step(1 / 120);
                return {
                    first: lastShot.firstContact,
                    foul: lastShot.foul,
                    tenPotted: target.potted,
                    player: currentPlayer,
                };
            });
            expect(res.first).toBe(2);
            expect(res.foul).toBe(false);
            expect(res.tenPotted).toBe(true);
            expect(res.player).toBe(2);
        });

        test('potting the 8-ball early loses the game', async ({ page }) => {
            await setTable(page, {
                cue: { x: 300, y: 240 },
                balls: [{ n: 8, x: 700, y: 300 }, { n: 2, x: 200, y: 120 }],
                groups: { 1: 'solid', 2: 'stripe' },
                player: 1,
            });
            await page.evaluate(() => {
                const b = balls.find((x) => x.n === 8);
                const ang = Math.atan2(PLAY_B - 21 - b.y, PLAY_R - 21 - b.x);
                balls[0].x = b.x - Math.cos(ang) * 40;
                balls[0].y = b.y - Math.sin(ang) * 40;
                shoot(ang, 0.55);
            });
            await settle(page);
            const res = await page.evaluate(() => ({ state, winner }));
            expect(res.state).toBe('gameover');
            expect(res.winner).toBe(2);
        });

        test('potting the 8-ball after clearing your group wins', async ({ page }) => {
            await setTable(page, {
                cue: { x: 300, y: 240 },
                balls: [{ n: 8, x: 700, y: 300 }],
                groups: { 1: 'solid', 2: 'stripe' },
                player: 1,
            });
            await page.evaluate(() => {
                const b = balls.find((x) => x.n === 8);
                const ang = Math.atan2(PLAY_B - 21 - b.y, PLAY_R - 21 - b.x);
                balls[0].x = b.x - Math.cos(ang) * 40;
                balls[0].y = b.y - Math.sin(ang) * 40;
                shoot(ang, 0.55);
            });
            await settle(page);
            const res = await page.evaluate(() => ({ state, winner }));
            expect(res.state).toBe('gameover');
            expect(res.winner).toBe(1);
        });

        test('the winner is announced on the overlay', async ({ page }) => {
            await page.evaluate(() => {
                startGame();
                aiEnabled = false;
                winner = 1;
                endGame(1);
            });
            await expect(page.locator('#overlay')).toHaveClass(/visible/);
            await expect(page.locator('#overlay-title')).toContainText(/win/i);
        });

        test('no shooting once the game is over', async ({ page }) => {
            const accepted = await page.evaluate(() => {
                startGame();
                aiEnabled = false;
                endGame(2);
                return shoot(0, 1);
            });
            expect(accepted).toBe(false);
        });
    });

    // -----------------------------------------------------------------------
    // Ball in hand
    // -----------------------------------------------------------------------
    test.describe('ball in hand', () => {
        test.beforeEach(async ({ page }) => {
            await setTable(page, {
                cue: { x: 300, y: 240 },
                balls: [{ n: 2, x: 500, y: 240 }],
                groups: { 1: 'solid', 2: 'stripe' },
                player: 1,
            });
            await page.evaluate(() => {
                balls[0].potted = true;
                state = 'ballinhand';
            });
        });

        test('placing the cue ball puts it back on the table and returns to aiming', async ({ page }) => {
            const res = await page.evaluate(() => {
                const ok = placeCue(200, 300);
                return { ok, x: balls[0].x, y: balls[0].y, potted: balls[0].potted, state };
            });
            expect(res).toEqual({ ok: true, x: 200, y: 300, potted: false, state: 'aiming' });
        });

        test('the cue ball cannot be placed on top of another ball', async ({ page }) => {
            const res = await page.evaluate(() => ({ ok: placeCue(505, 245), state }));
            expect(res.ok).toBe(false);
            expect(res.state).toBe('ballinhand');
        });

        test('the cue ball cannot be placed off the playfield', async ({ page }) => {
            const res = await page.evaluate(() => [placeCue(5, 5), placeCue(870, 240), placeCue(400, 470)]);
            expect(res).toEqual([false, false, false]);
        });

        test('the cue ball cannot be placed in a pocket', async ({ page }) => {
            const ok = await page.evaluate(() => placeCue(PLAY_L + 4, PLAY_T + 4));
            expect(ok).toBe(false);
        });

        test('clicking the table places the cue ball', async ({ page }) => {
            const box = await page.locator('#canvas').boundingBox();
            await page.mouse.click(box.x + 200, box.y + 320);
            const res = await page.evaluate(() => ({ state, potted: balls[0].potted }));
            expect(res).toEqual({ state: 'aiming', potted: false });
        });

        test('shooting is blocked until the cue ball is placed', async ({ page }) => {
            const accepted = await page.evaluate(() => shoot(0, 1));
            expect(accepted).toBe(false);
        });
    });

    // -----------------------------------------------------------------------
    // HUD & controls
    // -----------------------------------------------------------------------
    test.describe('hud and controls', () => {
        test('the HUD shows whose turn it is', async ({ page }) => {
            await page.evaluate(() => {
                startGame();
                aiEnabled = false;
                currentPlayer = 2;
                updateHud();
            });
            await expect(page.locator('#turn')).toContainText(/2|rival|computer/i);
        });

        test('group labels update once groups are assigned', async ({ page }) => {
            await page.evaluate(() => {
                startGame();
                aiEnabled = false;
                groups[1] = 'stripe';
                groups[2] = 'solid';
                updateHud();
            });
            await expect(page.locator('#p1-group')).toContainText(/stripe/i);
            await expect(page.locator('#p2-group')).toContainText(/solid/i);
        });

        test('remaining counts drop as balls are potted', async ({ page }) => {
            await page.evaluate(() => {
                startGame();
                aiEnabled = false;
                groups[1] = 'solid';
                groups[2] = 'stripe';
                balls.find((b) => b.n === 1).potted = true;
                balls.find((b) => b.n === 2).potted = true;
                updateHud();
            });
            await expect(page.locator('#p1-left')).toHaveText('5');
            await expect(page.locator('#p2-left')).toHaveText('7');
        });

        test('a foul is reported in the status message', async ({ page }) => {
            await setTable(page, {
                cue: { x: 300, y: 240 },
                balls: [{ n: 2, x: 300, y: 100 }],
                groups: { 1: 'solid', 2: 'stripe' },
                player: 1,
            });
            await page.evaluate(() => shoot(0, 0.15));
            await settle(page);
            await expect(page.locator('#message')).toContainText(/foul/i);
        });

        test('arrow keys adjust the aim', async ({ page }) => {
            await page.evaluate(() => {
                startGame();
                aiEnabled = false;
                aimAngle = 0;
            });
            await page.keyboard.press('ArrowRight');
            const a = await page.evaluate(() => aimAngle);
            expect(a).toBeGreaterThan(0);
            await page.keyboard.press('ArrowLeft');
            await page.keyboard.press('ArrowLeft');
            const b = await page.evaluate(() => aimAngle);
            expect(b).toBeLessThan(a);
        });

        test('moving the mouse over the table aims the cue', async ({ page }) => {
            await page.evaluate(() => {
                startGame();
                aiEnabled = false;
                balls[0].x = 240;
                balls[0].y = 240;
            });
            const box = await page.locator('#canvas').boundingBox();
            await page.mouse.move(box.x + 240, box.y + 400);
            const a = await page.evaluate(() => aimAngle);
            expect(a).toBeGreaterThan(1.2);
            expect(a).toBeLessThan(1.9);
        });

        test('holding Space charges the power meter and releasing shoots', async ({ page }) => {
            await page.evaluate(() => {
                startGame();
                aiEnabled = false;
                aimAngle = 0;
            });
            await page.keyboard.down('Space');
            await page.waitForTimeout(250);
            const charging = await page.evaluate(() => ({ charging, power }));
            expect(charging.charging).toBe(true);
            expect(charging.power).toBeGreaterThan(0);
            const width = await page.locator('#power-fill').evaluate((el) => el.style.width);
            expect(parseFloat(width)).toBeGreaterThan(0);
            await page.keyboard.up('Space');
            const after = await page.evaluate(() => ({ state, moving: ballsMoving() }));
            expect(after.state).toBe('rolling');
            expect(after.moving).toBe(true);
        });

        test('dragging on the canvas charges and shoots', async ({ page }) => {
            await page.evaluate(() => {
                startGame();
                aiEnabled = false;
            });
            const box = await page.locator('#canvas').boundingBox();
            await page.mouse.move(box.x + 600, box.y + 240);
            await page.mouse.down();
            await page.waitForTimeout(250);
            expect(await page.evaluate(() => charging)).toBe(true);
            await page.mouse.up();
            expect(await page.evaluate(() => state)).toBe('rolling');
        });

        test('P pauses and resumes', async ({ page }) => {
            await page.evaluate(() => {
                startGame();
                aiEnabled = false;
                shoot(0, 1);
            });
            await page.keyboard.press('p');
            expect(await page.evaluate(() => state)).toBe('paused');
            const frozen = await page.evaluate(() => {
                const before = balls[0].x;
                for (let i = 0; i < 60; i++) step(1 / 60);
                return balls[0].x === before;
            });
            expect(frozen).toBe(true);
            await page.keyboard.press('p');
            expect(await page.evaluate(() => state)).toBe('rolling');
        });

        test('the mode button toggles between the computer and two players', async ({ page }) => {
            await page.evaluate(() => startGame());
            const first = await page.evaluate(() => aiEnabled);
            await page.locator('#btn-mode').click();
            const second = await page.evaluate(() => aiEnabled);
            expect(second).toBe(!first);
            await expect(page.locator('#btn-mode')).toContainText(/player|computer/i);
        });
    });

    // -----------------------------------------------------------------------
    // Computer opponent
    // -----------------------------------------------------------------------
    test.describe('computer opponent', () => {
        test('the computer finds a straight-in shot', async ({ page }) => {
            await setTable(page, {
                cue: { x: 640, y: 240 },
                balls: [{ n: 10, x: 740, y: 340 }],
                groups: { 1: 'solid', 2: 'stripe' },
                player: 2,
            });
            const shot = await page.evaluate(() => aiChooseShot());
            expect(shot).not.toBe(null);
            expect(shot.angle).toBeGreaterThan(Math.PI / 4 - 0.25);
            expect(shot.angle).toBeLessThan(Math.PI / 4 + 0.25);
        });

        test('the computer pots the straight-in shot it found', async ({ page }) => {
            await setTable(page, {
                cue: { x: 640, y: 240 },
                balls: [{ n: 10, x: 740, y: 340 }],
                groups: { 1: 'solid', 2: 'stripe' },
                player: 2,
            });
            const potted = await page.evaluate(() => {
                AI_ERROR = 0;
                const shot = aiChooseShot();
                shoot(shot.angle, shot.power);
                for (let i = 0; i < 6000 && (state === 'rolling' || ballsMoving()); i++) step(1 / 120);
                return balls.find((b) => b.n === 10).potted;
            });
            expect(potted).toBe(true);
        });

        test('the computer does not aim at the opponent group', async ({ page }) => {
            await setTable(page, {
                cue: { x: 300, y: 240 },
                balls: [{ n: 1, x: 700, y: 300 }, { n: 11, x: 500, y: 150 }],
                groups: { 1: 'solid', 2: 'stripe' },
                player: 2,
            });
            const shot = await page.evaluate(() => aiChooseShot());
            expect(shot.target).toBe(11);
        });

        test('with its group cleared the computer plays the 8-ball', async ({ page }) => {
            await setTable(page, {
                cue: { x: 300, y: 240 },
                balls: [{ n: 8, x: 700, y: 300 }, { n: 1, x: 500, y: 150 }],
                groups: { 1: 'solid', 2: 'stripe' },
                player: 2,
            });
            const shot = await page.evaluate(() => aiChooseShot());
            expect(shot.target).toBe(8);
        });

        test('the computer takes its turn on its own', async ({ page }) => {
            await setTable(page, {
                cue: { x: 300, y: 240 },
                balls: [{ n: 11, x: 500, y: 250 }],
                groups: { 1: 'solid', 2: 'stripe' },
                player: 2,
            });
            const shot = await page.evaluate(() => {
                aiEnabled = true;
                beginTurn();
                for (let i = 0; i < 600 && state === 'aiming'; i++) step(1 / 60);
                return { state, moving: ballsMoving() };
            });
            expect(shot.state).toBe('rolling');
        });

        test('the computer places the cue ball when it has ball in hand', async ({ page }) => {
            await setTable(page, {
                cue: { x: 300, y: 240 },
                balls: [{ n: 11, x: 500, y: 250 }],
                groups: { 1: 'solid', 2: 'stripe' },
                player: 2,
            });
            const res = await page.evaluate(() => {
                aiEnabled = true;
                balls[0].potted = true;
                state = 'ballinhand';
                aiTimer = 0.3;
                for (let i = 0; i < 600 && state === 'ballinhand'; i++) step(1 / 60);
                return { state, potted: balls[0].potted };
            });
            expect(res.potted).toBe(false);
            expect(['aiming', 'rolling']).toContain(res.state);
        });

        test('the computer never shoots in two-player mode', async ({ page }) => {
            await setTable(page, {
                cue: { x: 300, y: 240 },
                balls: [{ n: 11, x: 500, y: 250 }],
                groups: { 1: 'solid', 2: 'stripe' },
                player: 2,
            });
            const s = await page.evaluate(() => {
                aiEnabled = false;
                beginTurn();
                for (let i = 0; i < 600; i++) step(1 / 60);
                return state;
            });
            expect(s).toBe('aiming');
        });
    });

    // -----------------------------------------------------------------------
    // A full game can actually be played out
    // -----------------------------------------------------------------------
    test.describe('playthrough', () => {
        test('the computer can play both sides to a finish', async ({ page }) => {
            test.setTimeout(40_000);
            const res = await page.evaluate(() => {
                startGame();
                aiEnabled = false;
                AI_ERROR = 0.004;
                let shots = 0;
                while (state !== 'gameover' && shots < 400) {
                    if (state === 'ballinhand') {
                        aiPlaceCue();
                    }
                    const shot = aiChooseShot();
                    if (shot) shoot(shot.angle, shot.power);
                    else shoot(Math.random() * Math.PI * 2, 0.5);
                    shots++;
                    for (let i = 0; i < 8000 && (state === 'rolling' || ballsMoving()); i++) {
                        step(1 / 120);
                    }
                }
                return { state, shots, winner, potted: balls.filter((b) => b.potted).length };
            });
            expect(res.state).toBe('gameover');
            expect([1, 2]).toContain(res.winner);
        });
    });
});
