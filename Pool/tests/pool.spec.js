const { test, expect } = require('@playwright/test');
const path = require('path');
const { pathToFileURL } = require('url');

const GAME_URL = pathToFileURL(path.resolve(__dirname, '../index.html')).href;

// Run the table forward until every ball has come to rest (or we give up).
// Returns the number of sub-frames simulated.
const settle = (page) =>
    page.evaluate(() => {
        let n = 0;
        while (state === 'rolling' && n < 4000) {
            step(1 / 120);
            n++;
        }
        return n;
    });

test.describe('Pool', () => {
    test.beforeEach(async ({ page }) => {
        await page.goto(GAME_URL);
    });

    // -----------------------------------------------------------------------
    // Initial / idle state
    // -----------------------------------------------------------------------
    test.describe('initial state', () => {
        test('page title is Pool', async ({ page }) => {
            await expect(page).toHaveTitle('Pool');
        });

        test('start overlay is visible', async ({ page }) => {
            await expect(page.locator('#overlay')).toHaveClass(/visible/);
        });

        test('overlay prompts the player to start', async ({ page }) => {
            await expect(page.locator('#overlay-sub')).toContainText(/space|start/i);
        });

        test('canvas is 720x400', async ({ page }) => {
            const canvas = page.locator('#canvas');
            await expect(canvas).toHaveAttribute('width', '720');
            await expect(canvas).toHaveAttribute('height', '400');
        });

        test('shot count starts at 0', async ({ page }) => {
            await expect(page.locator('#shots')).toHaveText('0');
        });

        test('nine object balls remain', async ({ page }) => {
            await expect(page.locator('#remaining')).toHaveText('9');
        });

        test('best score is blank until a rack is cleared', async ({ page }) => {
            await expect(page.locator('#best')).toHaveText('—');
        });

        test('state is idle before starting', async ({ page }) => {
            expect(await page.evaluate(() => state)).toBe('idle');
        });

        test('power meter starts empty', async ({ page }) => {
            const width = await page.evaluate(
                () => document.getElementById('power-fill').style.width
            );
            expect(['', '0%', '0px']).toContain(width);
        });

        test('stepping while idle does nothing', async ({ page }) => {
            const moved = await page.evaluate(() => {
                cueBall.vx = 400;
                const before = cueBall.x;
                for (let i = 0; i < 30; i++) step(1 / 120);
                return cueBall.x !== before;
            });
            expect(moved).toBe(false);
        });

        test('best score loads from localStorage', async ({ page }) => {
            await page.evaluate(() => window.localStorage.setItem('pool-best-shots', '13'));
            await page.reload();
            await expect(page.locator('#best')).toHaveText('13');
        });
    });

    // -----------------------------------------------------------------------
    // The rack
    // -----------------------------------------------------------------------
    test.describe('the rack', () => {
        test('there are ten balls: a cue ball and nine numbered balls', async ({ page }) => {
            const numbers = await page.evaluate(() => balls.map((b) => b.n));
            expect(numbers).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
        });

        test('cueBall is the zero ball', async ({ page }) => {
            expect(await page.evaluate(() => cueBall === balls[0] && cueBall.n === 0)).toBe(true);
        });

        test('no ball starts sunk', async ({ page }) => {
            expect(await page.evaluate(() => balls.some((b) => b.sunk))).toBe(false);
        });

        test('every ball starts at rest', async ({ page }) => {
            expect(await page.evaluate(() => balls.every((b) => b.vx === 0 && b.vy === 0))).toBe(true);
        });

        test('every ball starts inside the play area', async ({ page }) => {
            const inside = await page.evaluate(() =>
                balls.every(
                    (b) =>
                        b.x >= PLAY_L + BALL_R &&
                        b.x <= PLAY_R - BALL_R &&
                        b.y >= PLAY_T + BALL_R &&
                        b.y <= PLAY_B - BALL_R
                )
            );
            expect(inside).toBe(true);
        });

        test('no two balls overlap in the rack', async ({ page }) => {
            const worst = await page.evaluate(() => {
                let min = Infinity;
                for (let i = 0; i < balls.length; i++) {
                    for (let j = i + 1; j < balls.length; j++) {
                        min = Math.min(min, Math.hypot(balls[i].x - balls[j].x, balls[i].y - balls[j].y));
                    }
                }
                return min;
            });
            expect(worst).toBeGreaterThanOrEqual(2 * 10);
        });

        test('no ball starts inside a pocket', async ({ page }) => {
            const safe = await page.evaluate(() =>
                balls.every((b) => pockets.every((p) => Math.hypot(b.x - p.x, b.y - p.y) > POCKET_R + 4))
            );
            expect(safe).toBe(true);
        });

        test('the cue ball sits left of the rack', async ({ page }) => {
            const ok = await page.evaluate(() => balls.slice(1).every((b) => b.x > cueBall.x));
            expect(ok).toBe(true);
        });

        test('there are six pockets', async ({ page }) => {
            expect(await page.evaluate(() => pockets.length)).toBe(6);
        });
    });

    // -----------------------------------------------------------------------
    // Starting a game
    // -----------------------------------------------------------------------
    test.describe('starting', () => {
        test('pressing Space starts the game', async ({ page }) => {
            await page.keyboard.press('Space');
            expect(await page.evaluate(() => state)).toBe('aiming');
        });

        test('the start button starts the game', async ({ page }) => {
            await page.locator('#btn-start').click();
            expect(await page.evaluate(() => state)).toBe('aiming');
        });

        test('the overlay hides once play begins', async ({ page }) => {
            await page.locator('#btn-start').click();
            await expect(page.locator('#overlay')).not.toHaveClass(/visible/);
        });

        test('starting resets shots and the rack', async ({ page }) => {
            await page.evaluate(() => {
                startGame();
                shots = 5;
                balls[1].sunk = true;
                startGame();
            });
            await expect(page.locator('#shots')).toHaveText('0');
            await expect(page.locator('#remaining')).toHaveText('9');
        });

        test('pressing R re-racks a game in progress', async ({ page }) => {
            await page.evaluate(() => {
                startGame();
                shoot(1);
            });
            await page.keyboard.press('r');
            expect(await page.evaluate(() => state)).toBe('aiming');
            await expect(page.locator('#shots')).toHaveText('0');
        });
    });

    // -----------------------------------------------------------------------
    // Aiming and power
    // -----------------------------------------------------------------------
    test.describe('aiming', () => {
        test.beforeEach(async ({ page }) => {
            await page.evaluate(() => startGame());
        });

        test('setAim points the cue at a target point', async ({ page }) => {
            const angle = await page.evaluate(() => {
                setAim(Math.atan2(0, 1));
                return aimAngle;
            });
            expect(angle).toBeCloseTo(0, 5);
        });

        test('ArrowLeft rotates the aim anticlockwise', async ({ page }) => {
            const before = await page.evaluate(() => {
                setAim(0);
                return aimAngle;
            });
            await page.keyboard.press('ArrowLeft');
            const after = await page.evaluate(() => aimAngle);
            expect(after).toBeLessThan(before);
        });

        test('ArrowRight rotates the aim clockwise', async ({ page }) => {
            await page.evaluate(() => setAim(0));
            await page.keyboard.press('ArrowRight');
            expect(await page.evaluate(() => aimAngle)).toBeGreaterThan(0);
        });

        test('Shift+Arrow gives a finer adjustment', async ({ page }) => {
            await page.evaluate(() => setAim(0));
            await page.keyboard.press('ArrowRight');
            const coarse = await page.evaluate(() => aimAngle);
            await page.evaluate(() => setAim(0));
            await page.keyboard.press('Shift+ArrowRight');
            const fine = await page.evaluate(() => aimAngle);
            expect(fine).toBeGreaterThan(0);
            expect(fine).toBeLessThan(coarse);
        });

        test('charging fills the power meter', async ({ page }) => {
            const power = await page.evaluate(() => {
                beginCharge();
                updateCharge(0.5);
                return power;
            });
            expect(power).toBeGreaterThan(0);
            expect(power).toBeLessThanOrEqual(1);
            const fill = await page.evaluate(
                () => document.getElementById('power-fill').style.width
            );
            expect(parseFloat(fill)).toBeGreaterThan(0);
        });

        test('power never exceeds full', async ({ page }) => {
            const power = await page.evaluate(() => {
                beginCharge();
                updateCharge(30);
                return power;
            });
            expect(power).toBe(1);
        });

        test('releasing the charge takes the shot', async ({ page }) => {
            const result = await page.evaluate(() => {
                setAim(0);
                beginCharge();
                updateCharge(0.4);
                releaseCharge();
                return { state, shots, vx: cueBall.vx };
            });
            expect(result.state).toBe('rolling');
            expect(result.shots).toBe(1);
            expect(result.vx).toBeGreaterThan(0);
        });

        test('the power meter empties after the shot', async ({ page }) => {
            await page.evaluate(() => {
                beginCharge();
                updateCharge(0.4);
                releaseCharge();
            });
            expect(await page.evaluate(() => power)).toBe(0);
        });

        test('the cue ball leaves along the aim angle', async ({ page }) => {
            const angle = await page.evaluate(() => {
                setAim(-Math.PI / 4);
                shoot(0.8);
                return Math.atan2(cueBall.vy, cueBall.vx);
            });
            expect(angle).toBeCloseTo(-Math.PI / 4, 5);
        });

        test('a harder shot leaves faster', async ({ page }) => {
            const speeds = await page.evaluate(() => {
                setAim(0);
                shoot(0.2);
                const soft = Math.hypot(cueBall.vx, cueBall.vy);
                startGame();
                setAim(0);
                shoot(1);
                const hard = Math.hypot(cueBall.vx, cueBall.vy);
                return { soft, hard };
            });
            expect(speeds.hard).toBeGreaterThan(speeds.soft);
            expect(speeds.hard).toBeLessThanOrEqual(1150);
        });

        test('a shot cannot be taken while the balls are rolling', async ({ page }) => {
            const shots = await page.evaluate(() => {
                shoot(1);
                shoot(1);
                shoot(1);
                return shots;
            });
            expect(shots).toBe(1);
        });

        test('holding and releasing Space takes a shot', async ({ page }) => {
            await page.keyboard.down('Space');
            await page.waitForTimeout(250);
            await page.keyboard.up('Space');
            await expect(page.locator('#shots')).toHaveText('1');
        });

        test('dragging on the table aims and shoots', async ({ page }) => {
            const box = await page.locator('#canvas').boundingBox();
            await page.mouse.move(box.x + box.width - 20, box.y + box.height / 2);
            await page.mouse.down();
            await page.waitForTimeout(200);
            await page.mouse.up();
            const result = await page.evaluate(() => ({ shots, vx: cueBall.vx }));
            expect(result.shots).toBe(1);
            expect(result.vx).toBeGreaterThan(0);
        });
    });

    // -----------------------------------------------------------------------
    // Physics
    // -----------------------------------------------------------------------
    test.describe('physics', () => {
        test.beforeEach(async ({ page }) => {
            await page.evaluate(() => startGame());
        });

        test('friction brings the table to rest', async ({ page }) => {
            await page.evaluate(() => shoot(1));
            const frames = await settle(page);
            expect(frames).toBeLessThan(4000);
            expect(await page.evaluate(() => allStopped())).toBe(true);
        });

        test('a rolling ball slows down', async ({ page }) => {
            const speeds = await page.evaluate(() => {
                shoot(1);
                const before = Math.hypot(cueBall.vx, cueBall.vy);
                for (let i = 0; i < 30; i++) step(1 / 120);
                return { before, after: Math.hypot(cueBall.vx, cueBall.vy) };
            });
            expect(speeds.after).toBeLessThan(speeds.before);
            expect(speeds.after).toBeGreaterThan(0);
        });

        test('the cue ball bounces off the far cushion', async ({ page }) => {
            const vx = await page.evaluate(() => {
                // Clear the table so nothing is in the way, then fire down the rail.
                balls.slice(1).forEach((b) => (b.sunk = true));
                cueBall.x = PLAY_R - 200;
                cueBall.y = PLAY_T + BALL_R + 60;
                state = 'rolling';
                cueBall.vx = 700;
                cueBall.vy = 0;
                for (let i = 0; i < 90; i++) step(1 / 120);
                return cueBall.vx;
            });
            expect(vx).toBeLessThan(0);
        });

        test('a cushion bounce loses some energy', async ({ page }) => {
            const speeds = await page.evaluate(() => {
                balls.slice(1).forEach((b) => (b.sunk = true));
                cueBall.x = PLAY_R - 40;
                cueBall.y = PLAY_T + 120;
                state = 'rolling';
                cueBall.vx = 600;
                cueBall.vy = 0;
                const before = Math.abs(cueBall.vx);
                for (let i = 0; i < 20; i++) step(1 / 240);
                return { before, after: Math.abs(cueBall.vx) };
            });
            expect(speeds.after).toBeLessThan(speeds.before);
        });

        test('balls never leave the play area, even at full speed', async ({ page }) => {
            const escaped = await page.evaluate(() => {
                let bad = false;
                for (let a = 0; a < 16; a++) {
                    startGame();
                    setAim((a / 16) * Math.PI * 2);
                    shoot(1);
                    for (let i = 0; i < 1200 && state === 'rolling'; i++) {
                        step(1 / 120);
                        for (const b of balls) {
                            if (b.sunk) continue;
                            if (
                                b.x < PLAY_L - 0.5 ||
                                b.x > PLAY_R + 0.5 ||
                                b.y < PLAY_T - 0.5 ||
                                b.y > PLAY_B + 0.5
                            ) {
                                bad = true;
                            }
                        }
                    }
                }
                return bad;
            });
            expect(escaped).toBe(false);
        });

        test('balls never end up overlapping', async ({ page }) => {
            const worst = await page.evaluate(() => {
                let min = Infinity;
                startGame();
                setAim(0.02);
                shoot(1);
                for (let i = 0; i < 1500 && state === 'rolling'; i++) {
                    step(1 / 120);
                    const live = balls.filter((b) => !b.sunk);
                    for (let i2 = 0; i2 < live.length; i2++) {
                        for (let j = i2 + 1; j < live.length; j++) {
                            min = Math.min(
                                min,
                                Math.hypot(live[i2].x - live[j].x, live[i2].y - live[j].y)
                            );
                        }
                    }
                }
                return min;
            });
            // A tiny tolerance: separation is applied after integration.
            expect(worst).toBeGreaterThan(2 * 10 - 1.5);
        });

        test('a dead-on hit sends the object ball forward', async ({ page }) => {
            const result = await page.evaluate(() => {
                balls.slice(1).forEach((b) => (b.sunk = true));
                const target = balls[1];
                target.sunk = false;
                cueBall.x = PLAY_L + 60;
                cueBall.y = 200;
                target.x = PLAY_L + 200;
                target.y = 200;
                state = 'rolling';
                cueBall.vx = 600;
                cueBall.vy = 0;
                for (let i = 0; i < 120; i++) step(1 / 240);
                return { targetVx: target.vx, targetVy: target.vy, cueVx: cueBall.vx };
            });
            expect(result.targetVx).toBeGreaterThan(300);
            expect(Math.abs(result.targetVy)).toBeLessThan(20);
            expect(result.cueVx).toBeLessThan(result.targetVx);
        });

        test('a cut shot sends the object ball off at an angle', async ({ page }) => {
            const vy = await page.evaluate(() => {
                balls.slice(1).forEach((b) => (b.sunk = true));
                const target = balls[1];
                target.sunk = false;
                cueBall.x = PLAY_L + 60;
                cueBall.y = 200;
                target.x = PLAY_L + 200;
                target.y = 200 - BALL_R; // hit above centre -> object ball goes down-ish
                state = 'rolling';
                cueBall.vx = 600;
                cueBall.vy = 0;
                for (let i = 0; i < 120; i++) step(1 / 240);
                return target.vy;
            });
            expect(vy).toBeLessThan(-30);
        });

        test('a collision does not create energy', async ({ page }) => {
            const energy = await page.evaluate(() => {
                balls.slice(1).forEach((b) => (b.sunk = true));
                const target = balls[1];
                target.sunk = false;
                cueBall.x = PLAY_L + 60;
                cueBall.y = 200;
                target.x = PLAY_L + 140;
                target.y = 200;
                state = 'rolling';
                cueBall.vx = 600;
                cueBall.vy = 0;
                const before = 600 * 600;
                for (let i = 0; i < 40; i++) step(1 / 240);
                const after =
                    cueBall.vx ** 2 + cueBall.vy ** 2 + target.vx ** 2 + target.vy ** 2;
                return { before, after };
            });
            expect(energy.after).toBeLessThanOrEqual(energy.before);
        });
    });

    // -----------------------------------------------------------------------
    // Pocketing
    // -----------------------------------------------------------------------
    test.describe('pocketing', () => {
        test.beforeEach(async ({ page }) => {
            await page.evaluate(() => startGame());
        });

        test('a ball rolled into a pocket is sunk', async ({ page }) => {
            const result = await page.evaluate(() => {
                balls.slice(1).forEach((b) => (b.sunk = true));
                const target = balls[1];
                target.sunk = false;
                const pocket = pockets[0];
                target.x = pocket.x + 80;
                target.y = pocket.y + 80;
                state = 'rolling';
                target.vx = -300;
                target.vy = -300;
                for (let i = 0; i < 200; i++) step(1 / 240);
                return { sunk: target.sunk, remaining: ballsRemaining() };
            });
            expect(result.sunk).toBe(true);
            expect(result.remaining).toBe(0);
        });

        test('sinking a ball updates the remaining counter', async ({ page }) => {
            await page.evaluate(() => {
                const target = balls[3];
                const pocket = pockets[0];
                target.x = pocket.x + 60;
                target.y = pocket.y + 60;
                state = 'rolling';
                target.vx = -300;
                target.vy = -300;
                for (let i = 0; i < 200 && state === 'rolling'; i++) step(1 / 240);
            });
            await expect(page.locator('#remaining')).toHaveText('8');
        });

        test('a sunk ball stops moving', async ({ page }) => {
            const still = await page.evaluate(() => {
                const target = balls[3];
                const pocket = pockets[0];
                target.x = pocket.x + 60;
                target.y = pocket.y + 60;
                state = 'rolling';
                target.vx = -300;
                target.vy = -300;
                for (let i = 0; i < 200 && state === 'rolling'; i++) step(1 / 240);
                return target.vx === 0 && target.vy === 0;
            });
            expect(still).toBe(true);
        });

        test('a sunk ball no longer collides', async ({ page }) => {
            const moved = await page.evaluate(() => {
                balls.slice(1).forEach((b) => (b.sunk = true));
                balls[2].x = PLAY_L + 200;
                balls[2].y = 200;
                cueBall.x = PLAY_L + 60;
                cueBall.y = 200;
                state = 'rolling';
                cueBall.vx = 600;
                for (let i = 0; i < 120; i++) step(1 / 240);
                return balls[2].vx !== 0 || balls[2].vy !== 0;
            });
            expect(moved).toBe(false);
        });

        test('scratching costs a penalty shot', async ({ page }) => {
            const result = await page.evaluate(() => {
                shots = 4;
                const pocket = pockets[0];
                cueBall.x = pocket.x + 60;
                cueBall.y = pocket.y + 60;
                state = 'rolling';
                cueBall.vx = -300;
                cueBall.vy = -300;
                for (let i = 0; i < 200 && state === 'rolling'; i++) step(1 / 240);
                return { shots, sunk: cueBall.sunk };
            });
            expect(result.shots).toBe(5);
            expect(result.sunk).toBe(false);
        });

        test('a scratched cue ball is re-spotted clear of other balls', async ({ page }) => {
            const clear = await page.evaluate(() => {
                const pocket = pockets[0];
                cueBall.x = pocket.x + 60;
                cueBall.y = pocket.y + 60;
                state = 'rolling';
                cueBall.vx = -300;
                cueBall.vy = -300;
                for (let i = 0; i < 400 && state === 'rolling'; i++) step(1 / 240);
                return balls
                    .slice(1)
                    .filter((b) => !b.sunk)
                    .every((b) => Math.hypot(b.x - cueBall.x, b.y - cueBall.y) >= 2 * BALL_R);
            });
            expect(clear).toBe(true);
        });

        test('scratching does not sink object balls', async ({ page }) => {
            await page.evaluate(() => {
                const pocket = pockets[0];
                cueBall.x = pocket.x + 60;
                cueBall.y = pocket.y + 60;
                state = 'rolling';
                cueBall.vx = -300;
                cueBall.vy = -300;
                for (let i = 0; i < 400 && state === 'rolling'; i++) step(1 / 240);
            });
            await expect(page.locator('#remaining')).toHaveText('9');
        });
    });

    // -----------------------------------------------------------------------
    // Turn flow and winning
    // -----------------------------------------------------------------------
    test.describe('game flow', () => {
        test.beforeEach(async ({ page }) => {
            await page.evaluate(() => startGame());
        });

        test('the table returns to aiming once it settles', async ({ page }) => {
            await page.evaluate(() => shoot(0.8));
            await settle(page);
            expect(await page.evaluate(() => state)).toBe('aiming');
        });

        test('each shot increments the counter', async ({ page }) => {
            for (let s = 0; s < 3; s++) {
                // Aim back down the table, away from every pocket, so the run
                // is a clean three strokes with no scratch penalty.
                await page.evaluate(() => {
                    setAim(Math.PI);
                    shoot(0.3);
                });
                await settle(page);
            }
            await expect(page.locator('#shots')).toHaveText('3');
        });

        test('clearing the rack wins the game', async ({ page }) => {
            const result = await page.evaluate(() => {
                shots = 7;
                balls.slice(1, 9).forEach((b) => (b.sunk = true));
                const target = balls[9];
                const pocket = pockets[0];
                target.x = pocket.x + 60;
                target.y = pocket.y + 60;
                state = 'rolling';
                target.vx = -300;
                target.vy = -300;
                for (let i = 0; i < 400 && state === 'rolling'; i++) step(1 / 240);
                return { state, remaining: ballsRemaining() };
            });
            expect(result.remaining).toBe(0);
            expect(result.state).toBe('won');
        });

        test('the win overlay reports the shot count', async ({ page }) => {
            await page.evaluate(() => {
                shots = 7;
                balls.slice(1, 9).forEach((b) => (b.sunk = true));
                const target = balls[9];
                const pocket = pockets[0];
                target.x = pocket.x + 60;
                target.y = pocket.y + 60;
                state = 'rolling';
                target.vx = -300;
                target.vy = -300;
                for (let i = 0; i < 400 && state === 'rolling'; i++) step(1 / 240);
            });
            await expect(page.locator('#overlay')).toHaveClass(/visible/);
            await expect(page.locator('#overlay-title')).toContainText(/clear|win/i);
            await expect(page.locator('#overlay-score')).toContainText('7');
        });

        test('a win records a new personal best', async ({ page }) => {
            const stored = await page.evaluate(() => {
                shots = 7;
                balls.slice(1, 9).forEach((b) => (b.sunk = true));
                const target = balls[9];
                const pocket = pockets[0];
                target.x = pocket.x + 60;
                target.y = pocket.y + 60;
                state = 'rolling';
                target.vx = -300;
                target.vy = -300;
                for (let i = 0; i < 400 && state === 'rolling'; i++) step(1 / 240);
                return window.localStorage.getItem('pool-best-shots');
            });
            expect(stored).toBe('7');
            await expect(page.locator('#best')).toHaveText('7');
        });

        test('a worse run does not overwrite the best', async ({ page }) => {
            const stored = await page.evaluate(() => {
                window.localStorage.setItem('pool-best-shots', '4');
                bestShots = 4;
                shots = 9;
                balls.slice(1, 9).forEach((b) => (b.sunk = true));
                const target = balls[9];
                const pocket = pockets[0];
                target.x = pocket.x + 60;
                target.y = pocket.y + 60;
                state = 'rolling';
                target.vx = -300;
                target.vy = -300;
                for (let i = 0; i < 400 && state === 'rolling'; i++) step(1 / 240);
                return window.localStorage.getItem('pool-best-shots');
            });
            expect(stored).toBe('4');
        });

        test('no shot can be taken after the rack is cleared', async ({ page }) => {
            const shots = await page.evaluate(() => {
                balls.slice(1).forEach((b) => (b.sunk = true));
                state = 'rolling';
                for (let i = 0; i < 10 && state === 'rolling'; i++) step(1 / 240);
                const before = shots;
                shoot(1);
                return { before, after: shots, state };
            });
            expect(shots.state).toBe('won');
            expect(shots.after).toBe(shots.before);
        });

        test('Space starts a fresh rack after a win', async ({ page }) => {
            await page.evaluate(() => {
                balls.slice(1).forEach((b) => (b.sunk = true));
                state = 'rolling';
                for (let i = 0; i < 10 && state === 'rolling'; i++) step(1 / 240);
            });
            await page.keyboard.press('Space');
            expect(await page.evaluate(() => state)).toBe('aiming');
            await expect(page.locator('#remaining')).toHaveText('9');
        });
    });

    // -----------------------------------------------------------------------
    // Rendering
    // -----------------------------------------------------------------------
    test.describe('rendering', () => {
        test('the table is drawn on the canvas', async ({ page }) => {
            const painted = await page.evaluate(() => {
                draw();
                const data = canvas.getContext('2d').getImageData(0, 0, CANVAS_W, CANVAS_H).data;
                const colours = new Set();
                for (let i = 0; i < data.length; i += 4 * 97) {
                    colours.add(`${data[i]},${data[i + 1]},${data[i + 2]}`);
                }
                return colours.size;
            });
            expect(painted).toBeGreaterThan(3);
        });

        test('the aim guide is only drawn while aiming', async ({ page }) => {
            const shown = await page.evaluate(() => {
                const before = showsAimGuide();
                startGame();
                const aiming = showsAimGuide();
                shoot(1);
                return { before, aiming, rolling: showsAimGuide() };
            });
            expect(shown.before).toBe(false);
            expect(shown.aiming).toBe(true);
            expect(shown.rolling).toBe(false);
        });

        test('the page loads without console errors', async ({ page }) => {
            const errors = [];
            page.on('pageerror', (e) => errors.push(e.message));
            page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
            await page.goto(GAME_URL);
            await page.locator('#btn-start').click();
            await page.waitForTimeout(300);
            expect(errors).toEqual([]);
        });
    });
});
