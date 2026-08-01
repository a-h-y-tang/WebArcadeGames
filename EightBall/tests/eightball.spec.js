const { test, expect } = require('@playwright/test');
const path = require('path');
const { pathToFileURL } = require('url');

const GAME_URL = pathToFileURL(path.resolve(__dirname, '../index.html')).href;

// Start a game with the render loop's stepping disabled so every test drives
// the simulation itself and nothing depends on wall-clock timing.
async function startDeterministic(page) {
    await page.evaluate(() => {
        autoStep = false;
        startGame();
    });
}

// Clear the table down to the cue ball plus the listed object balls, put each
// one exactly where the test wants it, and optionally assign the two groups.
// `objects` is [{ n, x, y }, ...].
async function setupTable(page, { cue, objects, groups }) {
    await page.evaluate(([cue, objects, groups]) => {
        if (groups) {
            players[0].group = groups[0];
            players[1].group = groups[1];
        }
        balls.forEach((b) => {
            b.vx = 0;
            b.vy = 0;
            b.potted = true;
        });
        const cueBall = getBall(0);
        cueBall.potted = false;
        cueBall.x = cue.x;
        cueBall.y = cue.y;
        objects.forEach((o) => {
            const b = getBall(o.n);
            b.potted = false;
            b.x = o.x;
            b.y = o.y;
        });
        updateHud();
    }, [cue, objects, groups || null]);
}

// The middle pocket on the bottom rail — every potting test lines a ball up
// straight at it, which keeps the shots exact and independent of the rack.
const MIDDLE_POCKET = { x: 400, y: 414 };

test.describe('8-Ball Pool', () => {
    test.beforeEach(async ({ page }) => {
        await page.goto(GAME_URL);
    });

    // -----------------------------------------------------------------------
    // Initial / idle state
    // -----------------------------------------------------------------------
    test.describe('initial state', () => {
        test('page title is 8-Ball Pool', async ({ page }) => {
            await expect(page).toHaveTitle('8-Ball Pool');
        });

        test('canvas is 800x440', async ({ page }) => {
            const canvas = page.locator('#canvas');
            await expect(canvas).toHaveAttribute('width', '800');
            await expect(canvas).toHaveAttribute('height', '440');
        });

        test('start overlay is visible and prompts the player', async ({ page }) => {
            await expect(page.locator('#overlay')).toHaveClass(/visible/);
            await expect(page.locator('#overlay-sub')).toContainText(/space|start/i);
        });

        test('state is idle before starting', async ({ page }) => {
            expect(await page.evaluate(() => state)).toBe('idle');
        });

        test('there are 16 balls in total', async ({ page }) => {
            expect(await page.evaluate(() => balls.length)).toBe(16);
        });

        test('table has six pockets', async ({ page }) => {
            expect(await page.evaluate(() => pockets.length)).toBe(6);
        });

        test('groupOf classifies ball numbers', async ({ page }) => {
            const groups = await page.evaluate(() => [0, 1, 7, 8, 9, 15].map(groupOf));
            expect(groups).toEqual(['cue', 'solid', 'solid', 'eight', 'stripe', 'stripe']);
        });
    });

    // -----------------------------------------------------------------------
    // Racking
    // -----------------------------------------------------------------------
    test.describe('racking', () => {
        test('Space starts the game and hides the overlay', async ({ page }) => {
            await page.keyboard.press('Space');
            expect(await page.evaluate(() => state)).toBe('aiming');
            await expect(page.locator('#overlay')).not.toHaveClass(/visible/);
        });

        test('Start button starts the game', async ({ page }) => {
            await page.locator('#btn-start').click();
            expect(await page.evaluate(() => state)).toBe('aiming');
        });

        test('all 16 balls are on the table after racking', async ({ page }) => {
            await startDeterministic(page);
            expect(await page.evaluate(() => balls.filter((b) => !b.potted).length)).toBe(16);
        });

        test('every ball starts inside the play area', async ({ page }) => {
            await startDeterministic(page);
            const inside = await page.evaluate(() =>
                balls.every(
                    (b) =>
                        b.x >= CUSHION + BALL_R &&
                        b.x <= CANVAS_W - CUSHION - BALL_R &&
                        b.y >= CUSHION + BALL_R &&
                        b.y <= CANVAS_H - CUSHION - BALL_R
                )
            );
            expect(inside).toBe(true);
        });

        test('no two balls overlap in the rack', async ({ page }) => {
            await startDeterministic(page);
            const minGap = await page.evaluate(() => {
                let min = Infinity;
                for (let i = 0; i < balls.length; i++) {
                    for (let j = i + 1; j < balls.length; j++) {
                        const d = Math.hypot(balls[i].x - balls[j].x, balls[i].y - balls[j].y);
                        min = Math.min(min, d);
                    }
                }
                return min;
            });
            expect(minGap).toBeGreaterThanOrEqual(20);
        });

        test('the cue ball is left of the rack and every ball is stationary', async ({ page }) => {
            await startDeterministic(page);
            const s = await page.evaluate(() => ({
                cueX: getBall(0).x,
                rackMinX: Math.min(...balls.filter((b) => b.n !== 0).map((b) => b.x)),
                moving: balls.some((b) => b.vx !== 0 || b.vy !== 0),
            }));
            expect(s.cueX).toBeLessThan(s.rackMinX);
            expect(s.moving).toBe(false);
        });

        test('the 8-ball sits in the middle of the rack', async ({ page }) => {
            await startDeterministic(page);
            const s = await page.evaluate(() => {
                const rack = balls.filter((b) => b.n !== 0);
                const xs = rack.map((b) => b.x);
                return {
                    eightX: getBall(8).x,
                    eightY: getBall(8).y,
                    minX: Math.min(...xs),
                    maxX: Math.max(...xs),
                    centreY: CANVAS_H / 2,
                };
            });
            expect(s.eightX).toBeGreaterThan(s.minX);
            expect(s.eightX).toBeLessThan(s.maxX);
            expect(Math.abs(s.eightY - s.centreY)).toBeLessThan(1);
        });

        test('a fresh game has no groups assigned and player 1 to shoot', async ({ page }) => {
            await startDeterministic(page);
            const s = await page.evaluate(() => ({
                turn,
                groups: players.map((p) => p.group),
                target: currentTargetGroup(),
                ballInHand,
            }));
            expect(s.turn).toBe(0);
            expect(s.groups).toEqual([null, null]);
            expect(s.target).toBe('open');
            expect(s.ballInHand).toBe(false);
        });
    });

    // -----------------------------------------------------------------------
    // Physics
    // -----------------------------------------------------------------------
    test.describe('physics', () => {
        test('a rolling ball slows down and eventually stops', async ({ page }) => {
            await startDeterministic(page);
            const s = await page.evaluate(() => {
                const cue = getBall(0);
                cue.vx = 400;
                cue.vy = 0;
                step(0.2);
                const mid = Math.hypot(cue.vx, cue.vy);
                for (let i = 0; i < 2000; i++) step(1 / 240);
                return { mid, end: Math.hypot(cue.vx, cue.vy), stopped: allStopped() };
            });
            expect(s.mid).toBeLessThan(400);
            expect(s.mid).toBeGreaterThan(0);
            expect(s.end).toBe(0);
            expect(s.stopped).toBe(true);
        });

        test('a ball bounces off a cushion instead of leaving the table', async ({ page }) => {
            await startDeterministic(page);
            const s = await page.evaluate(() => {
                const cue = getBall(0);
                cue.x = 250; // clear of the middle pocket at CANVAS_W / 2
                cue.y = CANVAS_H / 2;
                cue.vx = 0;
                cue.vy = -600;
                for (let i = 0; i < 240; i++) step(1 / 240);
                return { vy: cue.vy, y: cue.y };
            });
            expect(s.vy).toBeGreaterThan(0);
            expect(s.y).toBeGreaterThanOrEqual(26 + 10);
        });

        test('a head-on collision transfers the motion to the struck ball', async ({ page }) => {
            await startDeterministic(page);
            const s = await page.evaluate(() => {
                balls.forEach((b) => {
                    b.potted = b.n !== 0 && b.n !== 1;
                    b.vx = 0;
                    b.vy = 0;
                });
                const cue = getBall(0);
                const one = getBall(1);
                cue.potted = false;
                cue.x = 200;
                cue.y = 220;
                cue.vx = 500;
                one.potted = false;
                one.x = 300;
                one.y = 220;
                for (let i = 0; i < 120; i++) step(1 / 240);
                return { cueVx: cue.vx, oneVx: one.vx };
            });
            expect(s.oneVx).toBeGreaterThan(300);
            expect(s.cueVx).toBeLessThan(60);
        });

        test('a ball reaching a pocket is potted and taken off the table', async ({ page }) => {
            await startDeterministic(page);
            const s = await page.evaluate(() => {
                const cue = getBall(0);
                const p = pockets[0];
                cue.x = p.x + 60;
                cue.y = p.y + 60;
                const d = Math.hypot(60, 60);
                cue.vx = (-60 / d) * 400;
                cue.vy = (-60 / d) * 400;
                for (let i = 0; i < 240; i++) step(1 / 240);
                return { potted: cue.potted };
            });
            expect(s.potted).toBe(true);
        });

        test('potted balls are ignored by collisions', async ({ page }) => {
            await startDeterministic(page);
            const s = await page.evaluate(() => {
                balls.forEach((b) => {
                    b.potted = b.n !== 0;
                    b.vx = 0;
                    b.vy = 0;
                });
                const cue = getBall(0);
                cue.potted = false;
                cue.x = 200;
                cue.y = 220;
                cue.vx = 300;
                const ghost = getBall(1);
                ghost.x = 260;
                ghost.y = 220;
                for (let i = 0; i < 120; i++) step(1 / 240);
                return { cueVx: cue.vx, ghostVx: ghost.vx };
            });
            expect(s.ghostVx).toBe(0);
            expect(s.cueVx).toBeGreaterThan(0);
        });
    });

    // -----------------------------------------------------------------------
    // Aiming and shooting
    // -----------------------------------------------------------------------
    test.describe('aiming and shooting', () => {
        test('setAim stores the angle and setPower clamps to 0..1', async ({ page }) => {
            await startDeterministic(page);
            const s = await page.evaluate(() => {
                setAim(1.25);
                const angle = aim.angle;
                setPower(5);
                const high = aim.power;
                setPower(-2);
                return { angle, high, low: aim.power };
            });
            expect(s.angle).toBeCloseTo(1.25, 5);
            expect(s.high).toBe(1);
            expect(s.low).toBe(0);
        });

        test('arrow keys nudge the aim and the power', async ({ page }) => {
            await startDeterministic(page);
            await page.evaluate(() => {
                setAim(0);
                setPower(0.5);
            });
            await page.keyboard.press('ArrowRight');
            await page.keyboard.press('ArrowUp');
            const s = await page.evaluate(() => ({ angle: aim.angle, power: aim.power }));
            expect(s.angle).toBeGreaterThan(0);
            expect(s.power).toBeGreaterThan(0.5);
        });

        test('shooting sends the cue ball along the aim angle', async ({ page }) => {
            await startDeterministic(page);
            const s = await page.evaluate(() => {
                setAim(0);
                setPower(1);
                shoot();
                const cue = getBall(0);
                return { state, vx: cue.vx, vy: cue.vy };
            });
            expect(s.state).toBe('rolling');
            expect(s.vx).toBeGreaterThan(0);
            expect(Math.abs(s.vy)).toBeLessThan(1);
        });

        test('shot power scales the cue ball speed', async ({ page }) => {
            await startDeterministic(page);
            const s = await page.evaluate(() => {
                setAim(0);
                setPower(0.25);
                shoot();
                const soft = Math.hypot(getBall(0).vx, getBall(0).vy);
                startGame();
                setAim(0);
                setPower(1);
                shoot();
                const hard = Math.hypot(getBall(0).vx, getBall(0).vy);
                return { soft, hard };
            });
            expect(s.hard).toBeGreaterThan(s.soft * 2);
        });

        test('shooting with zero power does nothing', async ({ page }) => {
            await startDeterministic(page);
            const s = await page.evaluate(() => {
                setPower(0);
                shoot();
                return { state, vx: getBall(0).vx };
            });
            expect(s.state).toBe('aiming');
            expect(s.vx).toBe(0);
        });

        test('you cannot shoot while the balls are rolling', async ({ page }) => {
            await startDeterministic(page);
            const s = await page.evaluate(() => {
                setAim(0);
                setPower(1);
                shoot();
                const first = Math.hypot(getBall(0).vx, getBall(0).vy);
                setAim(Math.PI);
                setPower(1);
                shoot();
                return { first, after: Math.hypot(getBall(0).vx, getBall(0).vy) };
            });
            expect(s.after).toBeCloseTo(s.first, 5);
        });

        test('the table settles back to aiming after a break', async ({ page }) => {
            await startDeterministic(page);
            const s = await page.evaluate(() => {
                setAim(0);
                setPower(1);
                shoot();
                settle();
                return { state, stopped: allStopped() };
            });
            expect(s.stopped).toBe(true);
            expect(['aiming', 'over']).toContain(s.state);
        });
    });

    // -----------------------------------------------------------------------
    // Rules
    // -----------------------------------------------------------------------
    test.describe('rules', () => {
        test('potting on an open table assigns both groups', async ({ page }) => {
            await startDeterministic(page);
            await setupTable(page, {
                cue: { x: MIDDLE_POCKET.x, y: 200 },
                objects: [{ n: 3, x: MIDDLE_POCKET.x, y: 300 }],
            });
            const s = await page.evaluate(() => {
                setAim(Math.PI / 2);
                setPower(0.6);
                shoot();
                settle();
                return {
                    potted: getBall(3).potted,
                    groups: players.map((p) => p.group),
                    turn,
                    foul: shotInfo.foul,
                };
            });
            expect(s.potted).toBe(true);
            expect(s.foul).toBe(false);
            expect(s.groups[0]).toBe('solid');
            expect(s.groups[1]).toBe('stripe');
            expect(s.turn).toBe(0);
        });

        test('potting a stripe first on an open table makes you stripes', async ({ page }) => {
            await startDeterministic(page);
            await setupTable(page, {
                cue: { x: MIDDLE_POCKET.x, y: 200 },
                objects: [{ n: 11, x: MIDDLE_POCKET.x, y: 300 }],
            });
            const groups = await page.evaluate(() => {
                setAim(Math.PI / 2);
                setPower(0.6);
                shoot();
                settle();
                return players.map((p) => p.group);
            });
            expect(groups).toEqual(['stripe', 'solid']);
        });

        test('a legal pot keeps the shooter at the table', async ({ page }) => {
            await startDeterministic(page);
            await setupTable(page, {
                cue: { x: MIDDLE_POCKET.x, y: 200 },
                objects: [
                    { n: 2, x: MIDDLE_POCKET.x, y: 300 },
                    { n: 11, x: 200, y: 120 },
                ],
                groups: ['solid', 'stripe'],
            });
            const s = await page.evaluate(() => {
                setAim(Math.PI / 2);
                setPower(0.6);
                shoot();
                settle();
                return { turn, foul: shotInfo.foul, potted: getBall(2).potted, ballInHand, state };
            });
            expect(s.potted).toBe(true);
            expect(s.foul).toBe(false);
            expect(s.turn).toBe(0);
            expect(s.ballInHand).toBe(false);
            expect(s.state).toBe('aiming');
        });

        test('a legal shot with no pot passes the turn', async ({ page }) => {
            await startDeterministic(page);
            await setupTable(page, {
                cue: { x: 200, y: 220 },
                objects: [
                    { n: 2, x: 300, y: 220 },
                    { n: 11, x: 200, y: 120 },
                ],
                groups: ['solid', 'stripe'],
            });
            const s = await page.evaluate(() => {
                setAim(0);
                setPower(0.2);
                shoot();
                settle();
                return {
                    turn,
                    foul: shotInfo.foul,
                    ballInHand,
                    potted: getBall(2).potted,
                    firstHit: shotInfo.firstHit,
                };
            });
            expect(s.firstHit).toBe(2);
            expect(s.potted).toBe(false);
            expect(s.foul).toBe(false);
            expect(s.turn).toBe(1);
            expect(s.ballInHand).toBe(false);
        });

        test('missing every ball is a foul and gives ball in hand', async ({ page }) => {
            await startDeterministic(page);
            await setupTable(page, {
                cue: { x: 400, y: 220 },
                objects: [{ n: 2, x: 400, y: 100 }],
                groups: ['solid', 'stripe'],
            });
            const s = await page.evaluate(() => {
                setAim(0);
                setPower(0.05);
                shoot();
                settle();
                return { turn, foul: shotInfo.foul, ballInHand, firstHit: shotInfo.firstHit };
            });
            expect(s.firstHit).toBe(null);
            expect(s.foul).toBe(true);
            expect(s.turn).toBe(1);
            expect(s.ballInHand).toBe(true);
        });

        test('hitting the opponent group first is a foul', async ({ page }) => {
            await startDeterministic(page);
            await setupTable(page, {
                cue: { x: 200, y: 220 },
                objects: [
                    { n: 11, x: 320, y: 220 },
                    { n: 2, x: 200, y: 100 },
                ],
                groups: ['solid', 'stripe'],
            });
            const s = await page.evaluate(() => {
                setAim(0);
                setPower(0.4);
                shoot();
                settle();
                return { firstHit: shotInfo.firstHit, foul: shotInfo.foul, turn, ballInHand };
            });
            expect(s.firstHit).toBe(11);
            expect(s.foul).toBe(true);
            expect(s.turn).toBe(1);
            expect(s.ballInHand).toBe(true);
        });

        test('potting the cue ball is a scratch and re-spots it', async ({ page }) => {
            await startDeterministic(page);
            await setupTable(page, {
                cue: { x: MIDDLE_POCKET.x, y: 200 },
                objects: [{ n: 2, x: 150, y: 120 }],
                groups: ['solid', 'stripe'],
            });
            const s = await page.evaluate(() => {
                setAim(Math.PI / 2);
                setPower(0.4);
                shoot();
                settle();
                return {
                    scratched: shotInfo.potted.includes(0),
                    foul: shotInfo.foul,
                    cuePotted: getBall(0).potted,
                    turn,
                    ballInHand,
                };
            });
            expect(s.scratched).toBe(true);
            expect(s.foul).toBe(true);
            expect(s.cuePotted).toBe(false);
            expect(s.turn).toBe(1);
            expect(s.ballInHand).toBe(true);
        });

        test('a scratch cannot be followed by a shot until the cue ball is placed', async ({ page }) => {
            await startDeterministic(page);
            await setupTable(page, {
                cue: { x: MIDDLE_POCKET.x, y: 200 },
                objects: [{ n: 2, x: 150, y: 120 }],
                groups: ['solid', 'stripe'],
            });
            const s = await page.evaluate(() => {
                setAim(Math.PI / 2);
                setPower(0.4);
                shoot();
                settle();
                const fired = shoot();
                return { fired, state, speed: Math.hypot(getBall(0).vx, getBall(0).vy) };
            });
            expect(s.fired).toBe(false);
            expect(s.state).toBe('aiming');
            expect(s.speed).toBe(0);
        });

        test('clearing your group puts you on the 8-ball', async ({ page }) => {
            await startDeterministic(page);
            await setupTable(page, {
                cue: { x: 200, y: 220 },
                objects: [{ n: 8, x: 400, y: 220 }],
                groups: ['solid', 'stripe'],
            });
            const target = await page.evaluate(() => currentTargetGroup());
            expect(target).toBe('eight');
        });

        test('potting the 8-ball early loses the game', async ({ page }) => {
            await startDeterministic(page);
            await setupTable(page, {
                cue: { x: MIDDLE_POCKET.x, y: 200 },
                objects: [
                    { n: 8, x: MIDDLE_POCKET.x, y: 300 },
                    { n: 2, x: 150, y: 120 },
                ],
                groups: ['solid', 'stripe'],
            });
            const s = await page.evaluate(() => {
                setAim(Math.PI / 2);
                setPower(0.6);
                shoot();
                settle();
                return { state, winner, eightPotted: getBall(8).potted };
            });
            expect(s.eightPotted).toBe(true);
            expect(s.state).toBe('over');
            expect(s.winner).toBe(1);
        });

        test('potting the 8-ball after clearing your group wins', async ({ page }) => {
            await startDeterministic(page);
            await setupTable(page, {
                cue: { x: MIDDLE_POCKET.x, y: 200 },
                objects: [{ n: 8, x: MIDDLE_POCKET.x, y: 300 }],
                groups: ['solid', 'stripe'],
            });
            const s = await page.evaluate(() => {
                setAim(Math.PI / 2);
                setPower(0.6);
                shoot();
                settle();
                return { state, winner, foul: shotInfo.foul };
            });
            expect(s.foul).toBe(false);
            expect(s.state).toBe('over');
            expect(s.winner).toBe(0);
        });

        test('the game ignores shots once it is over', async ({ page }) => {
            await startDeterministic(page);
            const s = await page.evaluate(() => {
                endGame(0);
                setPower(1);
                const fired = shoot();
                return { fired, state, speed: Math.hypot(getBall(0).vx, getBall(0).vy) };
            });
            expect(s.fired).toBe(false);
            expect(s.state).toBe('over');
            expect(s.speed).toBe(0);
        });
    });

    // -----------------------------------------------------------------------
    // Ball in hand
    // -----------------------------------------------------------------------
    test.describe('ball in hand', () => {
        test('placing the cue ball moves it and clears ball in hand', async ({ page }) => {
            await startDeterministic(page);
            const s = await page.evaluate(() => {
                ballInHand = true;
                const ok = placeCue(150, 300);
                const cue = getBall(0);
                return { ok, x: cue.x, y: cue.y, ballInHand };
            });
            expect(s.ok).toBe(true);
            expect(s.x).toBe(150);
            expect(s.y).toBe(300);
            expect(s.ballInHand).toBe(false);
        });

        test('the cue ball cannot be placed off the table', async ({ page }) => {
            await startDeterministic(page);
            const s = await page.evaluate(() => {
                ballInHand = true;
                const before = { x: getBall(0).x, y: getBall(0).y };
                const ok = placeCue(2, 2);
                return { ok, moved: getBall(0).x !== before.x, ballInHand };
            });
            expect(s.ok).toBe(false);
            expect(s.moved).toBe(false);
            expect(s.ballInHand).toBe(true);
        });

        test('the cue ball cannot be placed on top of another ball', async ({ page }) => {
            await startDeterministic(page);
            const s = await page.evaluate(() => {
                ballInHand = true;
                const eight = getBall(8);
                const ok = placeCue(eight.x + 4, eight.y);
                return { ok, ballInHand };
            });
            expect(s.ok).toBe(false);
            expect(s.ballInHand).toBe(true);
        });

        test('placing is refused when there is no ball in hand', async ({ page }) => {
            await startDeterministic(page);
            const ok = await page.evaluate(() => {
                ballInHand = false;
                return placeCue(150, 300);
            });
            expect(ok).toBe(false);
        });
    });

    // -----------------------------------------------------------------------
    // HUD
    // -----------------------------------------------------------------------
    test.describe('HUD', () => {
        test('both players start on an open table', async ({ page }) => {
            await startDeterministic(page);
            await expect(page.locator('#p1-group')).toHaveText(/open/i);
            await expect(page.locator('#p2-group')).toHaveText(/open/i);
        });

        test('the active player is highlighted and switches with the turn', async ({ page }) => {
            await startDeterministic(page);
            await expect(page.locator('#player1')).toHaveClass(/active/);
            await expect(page.locator('#player2')).not.toHaveClass(/active/);
            await page.evaluate(() => {
                turn = 1;
                updateHud();
            });
            await expect(page.locator('#player2')).toHaveClass(/active/);
            await expect(page.locator('#player1')).not.toHaveClass(/active/);
        });

        test('group names and remaining counts are shown once assigned', async ({ page }) => {
            await startDeterministic(page);
            await page.evaluate(() => {
                players[0].group = 'solid';
                players[1].group = 'stripe';
                getBall(1).potted = true;
                getBall(2).potted = true;
                updateHud();
            });
            await expect(page.locator('#p1-group')).toHaveText(/solid/i);
            await expect(page.locator('#p2-group')).toHaveText(/stripe/i);
            await expect(page.locator('#p1-count')).toHaveText('5');
            await expect(page.locator('#p2-count')).toHaveText('7');
        });

        test('the power meter reflects the charged power', async ({ page }) => {
            await startDeterministic(page);
            await page.evaluate(() => setPower(0.5));
            const width = await page.locator('#power-fill').evaluate((el) => el.style.width);
            expect(width).toBe('50%');
        });

        test('a foul is announced in the message line', async ({ page }) => {
            await startDeterministic(page);
            await page.evaluate(() => {
                players[0].group = 'solid';
                players[1].group = 'stripe';
                balls.forEach((b) => {
                    b.vx = b.vy = 0;
                    b.potted = ![0, 2].includes(b.n);
                });
                const cue = getBall(0);
                cue.potted = false;
                cue.x = 400;
                cue.y = 220;
                const two = getBall(2);
                two.potted = false;
                two.x = 400;
                two.y = 100;
                setAim(0);
                setPower(0.05);
                shoot();
                settle();
            });
            await expect(page.locator('#message')).toContainText(/foul/i);
        });

        test('the overlay announces the winner when the game ends', async ({ page }) => {
            await startDeterministic(page);
            await page.evaluate(() => endGame(1));
            await expect(page.locator('#overlay')).toHaveClass(/visible/);
            await expect(page.locator('#overlay-title')).toContainText(/player 2/i);
        });

        test('R racks a new game after one finishes', async ({ page }) => {
            await startDeterministic(page);
            await page.evaluate(() => endGame(0));
            await page.keyboard.press('r');
            const s = await page.evaluate(() => ({
                state,
                onTable: balls.filter((b) => !b.potted).length,
                turn,
            }));
            expect(s.state).toBe('aiming');
            expect(s.onTable).toBe(16);
            expect(s.turn).toBe(0);
        });
    });
});
