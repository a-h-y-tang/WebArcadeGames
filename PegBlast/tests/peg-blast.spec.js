const { test, expect } = require('@playwright/test');
const path = require('path');
const { pathToFileURL } = require('url');

const GAME_URL = pathToFileURL(path.resolve(__dirname, '../index.html')).href;

// Hand the simulation over to the tests: the animation loop stops stepping so
// every frame of time that passes is one the test asked for.
async function takeControl(page) {
    await page.evaluate(() => { autoAdvance = false; });
}

// Advance the simulation by `frames` steps of `dt` seconds.
async function advance(page, frames, dt = 1 / 60) {
    await page.evaluate(([n, d]) => {
        for (let i = 0; i < n; i++) step(d);
    }, [frames, dt]);
}

test.describe('Peg Blast', () => {
    test.beforeEach(async ({ page }) => {
        await page.goto(GAME_URL);
        await takeControl(page);
    });

    // -----------------------------------------------------------------------
    // Initial state
    // -----------------------------------------------------------------------
    test.describe('initial state', () => {
        test('page title is Peg Blast', async ({ page }) => {
            await expect(page).toHaveTitle('Peg Blast');
        });

        test('canvas is 640x720', async ({ page }) => {
            const canvas = page.locator('#canvas');
            await expect(canvas).toHaveAttribute('width', '640');
            await expect(canvas).toHaveAttribute('height', '720');
        });

        test('start overlay is visible and prompts the player', async ({ page }) => {
            await expect(page.locator('#overlay')).toHaveClass(/visible/);
            await expect(page.locator('#overlay-sub')).toContainText(/space|start/i);
        });

        test('HUD starts at score 0, level 1, a full rack of balls', async ({ page }) => {
            await expect(page.locator('#score')).toHaveText('0');
            await expect(page.locator('#level')).toHaveText('1');
            await expect(page.locator('#balls')).toHaveText(String(await page.evaluate(() => BALLS_PER_LEVEL)));
        });

        test('state is idle before starting', async ({ page }) => {
            expect(await page.evaluate(() => state)).toBe('idle');
        });

        test('stepping while idle changes nothing', async ({ page }) => {
            const moved = await page.evaluate(() => {
                const before = JSON.stringify([ball, bucket]);
                for (let i = 0; i < 60; i++) step(1 / 60);
                return JSON.stringify([ball, bucket]) !== before;
            });
            expect(moved).toBe(false);
        });

        test('help text documents the controls', async ({ page }) => {
            const help = page.locator('.help');
            await expect(help).toContainText(/aim/i);
            await expect(help).toContainText(/fire/i);
        });

        test('best score is loaded from localStorage', async ({ page }) => {
            await page.evaluate(() => window.localStorage.setItem('peg-blast-best', '4321'));
            await page.reload();
            await expect(page.locator('#best')).toHaveText('4321');
        });
    });

    // -----------------------------------------------------------------------
    // Level layout
    // -----------------------------------------------------------------------
    test.describe('level layout', () => {
        test('the board has a field of pegs', async ({ page }) => {
            expect(await page.evaluate(() => pegs.length)).toBeGreaterThan(20);
        });

        test('exactly ORANGE_TARGET pegs are orange, the rest blue', async ({ page }) => {
            const counts = await page.evaluate(() => ({
                orange: pegs.filter((p) => p.type === 'orange').length,
                blue: pegs.filter((p) => p.type === 'blue').length,
                total: pegs.length,
                target: ORANGE_TARGET,
            }));
            expect(counts.orange).toBe(counts.target);
            expect(counts.blue).toBe(counts.total - counts.target);
        });

        test('every peg sits inside the board, clear of cannon and bucket', async ({ page }) => {
            const bad = await page.evaluate(() => pegs.filter((p) => (
                p.x < PEG_R || p.x > CANVAS_W - PEG_R
                || p.y < CANNON_Y + 80 || p.y > BUCKET_Y - 40
            )).length);
            expect(bad).toBe(0);
        });

        test('no two pegs overlap', async ({ page }) => {
            const closest = await page.evaluate(() => {
                let min = Infinity;
                for (let i = 0; i < pegs.length; i++) {
                    for (let j = i + 1; j < pegs.length; j++) {
                        const d = Math.hypot(pegs[i].x - pegs[j].x, pegs[i].y - pegs[j].y);
                        if (d < min) min = d;
                    }
                }
                return min;
            });
            expect(closest).toBeGreaterThan(await page.evaluate(() => PEG_R * 2));
        });

        test('no peg starts already hit', async ({ page }) => {
            expect(await page.evaluate(() => pegs.some((p) => p.hit))).toBe(false);
        });

        test('a level number always builds the same board', async ({ page }) => {
            const first = await page.evaluate(() => JSON.stringify(pegs));
            await page.reload();
            const second = await page.evaluate(() => JSON.stringify(pegs));
            expect(second).toBe(first);
        });

        test('different levels build different boards', async ({ page }) => {
            const boards = await page.evaluate(() => [1, 2, 3].map((n) => {
                buildLevel(n);
                return JSON.stringify(pegs);
            }));
            expect(new Set(boards).size).toBe(3);
        });
    });

    // -----------------------------------------------------------------------
    // Starting a game
    // -----------------------------------------------------------------------
    test.describe('starting', () => {
        test('Space starts the game and hides the overlay', async ({ page }) => {
            await page.keyboard.press('Space');
            expect(await page.evaluate(() => state)).toBe('aiming');
            await expect(page.locator('#overlay')).not.toHaveClass(/visible/);
        });

        test('the start button starts the game', async ({ page }) => {
            await page.locator('#btn-start').click();
            expect(await page.evaluate(() => state)).toBe('aiming');
        });

        test('the ball waits at the cannon while aiming', async ({ page }) => {
            await page.evaluate(() => startGame());
            const parked = await page.evaluate(() => ({
                x: ball.x, y: ball.y, vx: ball.vx, vy: ball.vy, cx: CANNON_X, cy: CANNON_Y,
            }));
            expect(parked.x).toBeCloseTo(parked.cx, 5);
            expect(parked.y).toBeCloseTo(parked.cy, 5);
            expect(parked.vx).toBe(0);
            expect(parked.vy).toBe(0);
        });

        test('the ball does not move while aiming', async ({ page }) => {
            await page.evaluate(() => startGame());
            await advance(page, 60);
            const still = await page.evaluate(() => ball.vx === 0 && ball.vy === 0 && ball.y === CANNON_Y);
            expect(still).toBe(true);
        });
    });

    // -----------------------------------------------------------------------
    // Aiming
    // -----------------------------------------------------------------------
    test.describe('aiming', () => {
        test.beforeEach(async ({ page }) => {
            await page.evaluate(() => startGame());
        });

        test('the cannon starts pointing straight down', async ({ page }) => {
            expect(await page.evaluate(() => aimAngle)).toBe(0);
        });

        test('aimBy swings the cannon', async ({ page }) => {
            const swung = await page.evaluate(() => { aimBy(0.3); return aimAngle; });
            expect(swung).toBeCloseTo(0.3, 5);
        });

        test('aim is clamped to the legal arc', async ({ page }) => {
            const limits = await page.evaluate(() => {
                aimBy(99);
                const hi = aimAngle;
                aimBy(-99);
                const lo = aimAngle;
                return { hi, lo, limit: AIM_LIMIT };
            });
            expect(limits.hi).toBeCloseTo(limits.limit, 5);
            expect(limits.lo).toBeCloseTo(-limits.limit, 5);
        });

        test('aimAt points the cannon towards a board position', async ({ page }) => {
            const angles = await page.evaluate(() => {
                aimAt(CANNON_X + 200, CANNON_Y + 200);
                const right = aimAngle;
                aimAt(CANNON_X - 200, CANNON_Y + 200);
                const left = aimAngle;
                aimAt(CANNON_X, CANNON_Y + 200);
                const down = aimAngle;
                return { right, left, down };
            });
            expect(angles.right).toBeGreaterThan(0);
            expect(angles.left).toBeLessThan(0);
            expect(angles.down).toBeCloseTo(0, 5);
        });

        test('holding an arrow key swings the cannon over time', async ({ page }) => {
            await page.keyboard.down('ArrowRight');
            await advance(page, 30);
            const right = await page.evaluate(() => aimAngle);
            await page.keyboard.up('ArrowRight');
            expect(right).toBeGreaterThan(0);

            await page.keyboard.down('ArrowLeft');
            await advance(page, 60);
            const left = await page.evaluate(() => aimAngle);
            await page.keyboard.up('ArrowLeft');
            expect(left).toBeLessThan(right);
        });

        test('releasing the key stops the swing', async ({ page }) => {
            await page.keyboard.down('ArrowRight');
            await advance(page, 20);
            await page.keyboard.up('ArrowRight');
            const before = await page.evaluate(() => aimAngle);
            await advance(page, 30);
            expect(await page.evaluate(() => aimAngle)).toBeCloseTo(before, 6);
        });
    });

    // -----------------------------------------------------------------------
    // Firing
    // -----------------------------------------------------------------------
    test.describe('firing', () => {
        test.beforeEach(async ({ page }) => {
            await page.evaluate(() => startGame());
        });

        test('firing launches the ball along the aim at launch speed', async ({ page }) => {
            const shot = await page.evaluate(() => {
                aimBy(0.4);
                fire();
                return {
                    state,
                    speed: Math.hypot(ball.vx, ball.vy),
                    vx: ball.vx,
                    vy: ball.vy,
                    launch: LAUNCH_SPEED,
                };
            });
            expect(shot.state).toBe('shooting');
            expect(shot.speed).toBeCloseTo(shot.launch, 3);
            expect(shot.vx).toBeGreaterThan(0);
            expect(shot.vy).toBeGreaterThan(0);
        });

        test('firing spends a ball', async ({ page }) => {
            const spent = await page.evaluate(() => {
                const before = ballsLeft;
                fire();
                return before - ballsLeft;
            });
            expect(spent).toBe(1);
        });

        test('the HUD ball count follows the state', async ({ page }) => {
            await page.evaluate(() => fire());
            await expect(page.locator('#balls')).toHaveText(await page.evaluate(() => String(ballsLeft)));
        });

        test('a second fire while a shot is live is ignored', async ({ page }) => {
            const result = await page.evaluate(() => {
                fire();
                const snapshot = { balls: ballsLeft, vx: ball.vx, vy: ball.vy };
                fire();
                return { snapshot, balls: ballsLeft, vx: ball.vx, vy: ball.vy };
            });
            expect(result.balls).toBe(result.snapshot.balls);
            expect(result.vx).toBe(result.snapshot.vx);
        });

        test('Space fires while aiming', async ({ page }) => {
            await page.keyboard.press('Space');
            expect(await page.evaluate(() => state)).toBe('shooting');
        });

        test('clicking the board fires', async ({ page }) => {
            await page.locator('#canvas').click({ position: { x: 320, y: 400 } });
            expect(await page.evaluate(() => state)).toBe('shooting');
        });
    });

    // -----------------------------------------------------------------------
    // Ball physics
    // -----------------------------------------------------------------------
    test.describe('physics', () => {
        test.beforeEach(async ({ page }) => {
            await page.evaluate(() => startGame());
        });

        test('gravity pulls the ball down', async ({ page }) => {
            const gained = await page.evaluate(() => {
                pegs.length = 0;
                fire();
                const before = ball.vy;
                for (let i = 0; i < 10; i++) step(1 / 60);
                return ball.vy - before;
            });
            expect(gained).toBeGreaterThan(0);
        });

        test('the ball bounces off a side wall and stays in bounds', async ({ page }) => {
            const run = await page.evaluate(() => {
                pegs.length = 0;
                state = 'shooting';
                ball.x = BALL_R + 4;
                ball.y = 200;
                ball.vx = -500;
                ball.vy = 0;
                let minX = Infinity;
                let bounced = false;
                for (let i = 0; i < 60 && state === 'shooting'; i++) {
                    step(1 / 60);
                    minX = Math.min(minX, ball.x);
                    if (ball.vx > 0) bounced = true;
                }
                return { minX, bounced };
            });
            expect(run.bounced).toBe(true);
            expect(run.minX).toBeGreaterThanOrEqual(await page.evaluate(() => BALL_R) - 0.5);
        });

        test('hitting a peg lights it up and scores it', async ({ page }) => {
            const hit = await page.evaluate(() => {
                const peg = pegs[0];
                state = 'shooting';
                ball.x = peg.x;
                ball.y = peg.y - 80;
                ball.vx = 0;
                ball.vy = 400;
                for (let i = 0; i < 60 && !peg.hit; i++) step(1 / 60);
                return { lit: peg.hit, score, vy: ball.vy };
            });
            expect(hit.lit).toBe(true);
            expect(hit.score).toBeGreaterThan(0);
            expect(hit.vy).toBeLessThan(0); // bounced back up
        });

        test('a peg only scores once, however often it is struck', async ({ page }) => {
            const scores = await page.evaluate(() => {
                const peg = pegs[0];
                state = 'shooting';
                ball.x = peg.x;
                ball.y = peg.y - 40;
                ball.vx = 0;
                ball.vy = 400;
                for (let i = 0; i < 30 && !peg.hit; i++) step(1 / 60);
                const first = score;
                for (let i = 0; i < 5; i++) {
                    ball.x = peg.x;
                    ball.y = peg.y - PEG_R - BALL_R + 2;
                    ball.vy = 300;
                    step(1 / 60);
                }
                return { first, after: score };
            });
            expect(scores.after).toBe(scores.first);
        });

        test('the ball is never left overlapping a peg', async ({ page }) => {
            const worst = await page.evaluate(() => {
                aimBy(0.12);
                fire();
                let worstOverlap = 0;
                for (let i = 0; i < 1200 && state === 'shooting'; i++) {
                    step(1 / 120);
                    for (const p of pegs) {
                        const d = Math.hypot(ball.x - p.x, ball.y - p.y);
                        worstOverlap = Math.max(worstOverlap, PEG_R + BALL_R - d);
                    }
                }
                return worstOverlap;
            });
            expect(worst).toBeLessThan(0.5);
        });

        test('ball speed is capped', async ({ page }) => {
            const top = await page.evaluate(() => {
                fire();
                let max = 0;
                for (let i = 0; i < 2000 && state === 'shooting'; i++) {
                    step(1 / 120);
                    max = Math.max(max, Math.hypot(ball.vx, ball.vy));
                }
                return { max, cap: MAX_SPEED };
            });
            expect(top.max).toBeLessThanOrEqual(top.cap + 0.001);
        });

        test('every shot ends, and lit pegs are cleared away', async ({ page }) => {
            const outcome = await page.evaluate(() => {
                aimBy(-0.2);
                fire();
                const before = pegs.length;
                let frames = 0;
                while (state === 'shooting' && frames < 6000) { step(1 / 120); frames++; }
                return { state, before, after: pegs.length, lit: pegs.filter((p) => p.hit).length };
            });
            expect(outcome.state).not.toBe('shooting');
            expect(outcome.after).toBeLessThan(outcome.before);
            expect(outcome.lit).toBe(0);
        });

        test('a wedged ball is released by the shot timer', async ({ page }) => {
            const ended = await page.evaluate(() => {
                fire();
                // Pin the ball in place: no matter what physics does, hold it.
                let frames = 0;
                while (state === 'shooting' && frames < 4000) {
                    ball.x = CANVAS_W / 2;
                    ball.y = 300;
                    ball.vx = 0;
                    ball.vy = 0;
                    step(1 / 60);
                    frames++;
                }
                return { state, seconds: frames / 60, limit: MAX_SHOT_TIME };
            });
            expect(ended.state).not.toBe('shooting');
            expect(ended.seconds).toBeLessThanOrEqual(ended.limit + 1);
        });
    });

    // -----------------------------------------------------------------------
    // Scoring
    // -----------------------------------------------------------------------
    test.describe('scoring', () => {
        test.beforeEach(async ({ page }) => {
            await page.evaluate(() => startGame());
        });

        test('an orange peg is worth more than a blue one', async ({ page }) => {
            const values = await page.evaluate(() => {
                function hitOne(type) {
                    score = 0;
                    orangesCleared = 0;
                    const peg = pegs.find((p) => p.type === type && !p.hit);
                    state = 'shooting';
                    ball.x = peg.x;
                    ball.y = peg.y - 60;
                    ball.vx = 0;
                    ball.vy = 400;
                    for (let i = 0; i < 60 && !peg.hit; i++) step(1 / 60);
                    return score;
                }
                return { blue: hitOne('blue'), orange: hitOne('orange') };
            });
            expect(values.blue).toBe(await page.evaluate(() => BLUE_POINTS));
            expect(values.orange).toBeGreaterThan(values.blue);
        });

        test('the multiplier climbs as oranges are cleared', async ({ page }) => {
            const steps = await page.evaluate(() => {
                const seen = [];
                for (const n of [0, 4, 8, 11, ORANGE_TARGET]) {
                    orangesCleared = n;
                    seen.push(multiplier());
                }
                return seen;
            });
            expect(steps[0]).toBe(1);
            for (let i = 1; i < steps.length; i++) {
                expect(steps[i]).toBeGreaterThan(steps[i - 1]);
            }
        });

        test('the multiplier is applied to peg values', async ({ page }) => {
            const scored = await page.evaluate(() => {
                orangesCleared = ORANGE_TARGET; // top multiplier
                score = 0;
                const peg = pegs.find((p) => p.type === 'blue');
                state = 'shooting';
                ball.x = peg.x;
                ball.y = peg.y - 60;
                ball.vx = 0;
                ball.vy = 400;
                for (let i = 0; i < 60 && !peg.hit; i++) step(1 / 60);
                return { score, expected: BLUE_POINTS * multiplier() };
            });
            expect(scored.score).toBe(scored.expected);
        });

        test('the HUD score updates as pegs are struck', async ({ page }) => {
            await page.evaluate(() => {
                const peg = pegs[0];
                state = 'shooting';
                ball.x = peg.x;
                ball.y = peg.y - 60;
                ball.vy = 400;
                for (let i = 0; i < 60 && !peg.hit; i++) step(1 / 60);
            });
            await expect(page.locator('#score')).not.toHaveText('0');
        });
    });

    // -----------------------------------------------------------------------
    // The bucket
    // -----------------------------------------------------------------------
    test.describe('bucket', () => {
        test.beforeEach(async ({ page }) => {
            await page.evaluate(() => startGame());
        });

        test('the bucket slides and reverses inside the walls', async ({ page }) => {
            const run = await page.evaluate(() => {
                let min = Infinity;
                let max = -Infinity;
                const dirs = new Set();
                for (let i = 0; i < 2400; i++) {
                    step(1 / 60);
                    min = Math.min(min, bucket.x - BUCKET_W / 2);
                    max = Math.max(max, bucket.x + BUCKET_W / 2);
                    dirs.add(Math.sign(bucket.vx));
                }
                return { min, max, dirs: dirs.size, w: CANVAS_W };
            });
            expect(run.min).toBeGreaterThanOrEqual(-0.001);
            expect(run.max).toBeLessThanOrEqual(run.w + 0.001);
            expect(run.dirs).toBe(2);
        });

        test('catching the ball awards a free ball and ends the shot', async ({ page }) => {
            const caught = await page.evaluate(() => {
                state = 'shooting';
                ballsLeft = 5;
                bucket.vx = 0;
                ball.x = bucket.x;
                ball.y = BUCKET_Y - 40;
                ball.vx = 0;
                ball.vy = 400;
                for (let i = 0; i < 120 && state === 'shooting'; i++) step(1 / 120);
                return { state, ballsLeft };
            });
            expect(caught.state).toBe('aiming');
            expect(caught.ballsLeft).toBe(6);
        });

        test('a ball that misses the bucket is simply lost', async ({ page }) => {
            const missed = await page.evaluate(() => {
                state = 'shooting';
                ballsLeft = 5;
                bucket.vx = 0;
                bucket.x = BUCKET_W / 2;
                ball.x = CANVAS_W - BALL_R;
                ball.y = BUCKET_Y - 40;
                ball.vx = 0;
                ball.vy = 400;
                for (let i = 0; i < 240 && state === 'shooting'; i++) step(1 / 120);
                return { state, ballsLeft };
            });
            expect(missed.state).toBe('aiming');
            expect(missed.ballsLeft).toBe(5);
        });
    });

    // -----------------------------------------------------------------------
    // Level flow
    // -----------------------------------------------------------------------
    test.describe('level flow', () => {
        test.beforeEach(async ({ page }) => {
            await page.evaluate(() => startGame());
        });

        test('clearing the last orange peg finishes the level', async ({ page }) => {
            const cleared = await page.evaluate(() => {
                pegs = pegs.filter((p) => p.type !== 'orange');
                state = 'shooting';
                ball.y = CANVAS_H + 50;
                step(1 / 60);
                return state;
            });
            expect(cleared).toBe('cleared');
            await expect(page.locator('#overlay')).toHaveClass(/visible/);
            await expect(page.locator('#overlay-title')).toContainText(/clear/i);
        });

        test('leftover balls become bonus points', async ({ page }) => {
            const bonus = await page.evaluate(() => {
                score = 0;
                ballsLeft = 4;
                pegs = pegs.filter((p) => p.type !== 'orange');
                state = 'shooting';
                ball.y = CANVAS_H + 50;
                step(1 / 60);
                return { score, expected: 4 * CLEAR_BONUS_PER_BALL };
            });
            expect(bonus.score).toBe(bonus.expected);
        });

        test('Space starts the next level with a fresh board', async ({ page }) => {
            await page.evaluate(() => {
                pegs = pegs.filter((p) => p.type !== 'orange');
                state = 'shooting';
                ball.y = CANVAS_H + 50;
                step(1 / 60);
            });
            await page.keyboard.press('Space');
            const next = await page.evaluate(() => ({
                state,
                level,
                ballsLeft,
                oranges: pegs.filter((p) => p.type === 'orange').length,
                target: ORANGE_TARGET,
                perLevel: BALLS_PER_LEVEL,
            }));
            expect(next.state).toBe('aiming');
            expect(next.level).toBe(2);
            expect(next.ballsLeft).toBe(next.perLevel);
            expect(next.oranges).toBe(next.target);
            await expect(page.locator('#level')).toHaveText('2');
        });

        test('the score carries across levels', async ({ page }) => {
            const carried = await page.evaluate(() => {
                score = 1234;
                ballsLeft = 0;
                pegs = pegs.filter((p) => p.type !== 'orange');
                state = 'shooting';
                ball.y = CANVAS_H + 50;
                step(1 / 60);
                nextLevel();
                return score;
            });
            expect(carried).toBe(1234);
        });

        test('running out of balls with oranges left ends the game', async ({ page }) => {
            const over = await page.evaluate(() => {
                ballsLeft = 0;
                state = 'shooting';
                ball.y = CANVAS_H + 50;
                bucket.x = -999; // keep the bucket well out of the way
                step(1 / 60);
                return state;
            });
            expect(over).toBe('over');
            await expect(page.locator('#overlay-title')).toContainText(/over/i);
        });

        test('the best score is recorded at game over', async ({ page }) => {
            const best = await page.evaluate(() => {
                score = 9876;
                ballsLeft = 0;
                state = 'shooting';
                ball.y = CANVAS_H + 50;
                bucket.x = -999;
                step(1 / 60);
                return window.localStorage.getItem('peg-blast-best');
            });
            expect(best).toBe('9876');
            await expect(page.locator('#best')).toHaveText('9876');
        });

        test('a lower score does not overwrite the best', async ({ page }) => {
            const best = await page.evaluate(() => {
                window.localStorage.setItem('peg-blast-best', '50000');
                bestScore = 50000;
                score = 10;
                ballsLeft = 0;
                state = 'shooting';
                ball.y = CANVAS_H + 50;
                bucket.x = -999;
                step(1 / 60);
                return window.localStorage.getItem('peg-blast-best');
            });
            expect(best).toBe('50000');
        });

        test('Space after game over restarts at level 1', async ({ page }) => {
            await page.evaluate(() => {
                score = 500;
                ballsLeft = 0;
                state = 'shooting';
                ball.y = CANVAS_H + 50;
                bucket.x = -999;
                step(1 / 60);
            });
            await page.keyboard.press('Space');
            const fresh = await page.evaluate(() => ({ state, level, score, ballsLeft }));
            expect(fresh.state).toBe('aiming');
            expect(fresh.level).toBe(1);
            expect(fresh.score).toBe(0);
            expect(fresh.ballsLeft).toBe(await page.evaluate(() => BALLS_PER_LEVEL));
        });
    });

    // -----------------------------------------------------------------------
    // Pausing
    // -----------------------------------------------------------------------
    test.describe('pausing', () => {
        test('P pauses and resumes, and freezes the simulation', async ({ page }) => {
            await page.evaluate(() => { startGame(); fire(); });
            await page.keyboard.press('p');
            expect(await page.evaluate(() => state)).toBe('paused');

            const frozen = await page.evaluate(() => {
                const before = JSON.stringify([ball, bucket]);
                for (let i = 0; i < 60; i++) step(1 / 60);
                return JSON.stringify([ball, bucket]) === before;
            });
            expect(frozen).toBe(true);

            await page.keyboard.press('p');
            expect(await page.evaluate(() => state)).toBe('shooting');
            const moved = await page.evaluate(() => {
                const before = ball.y;
                for (let i = 0; i < 10; i++) step(1 / 60);
                return ball.y !== before;
            });
            expect(moved).toBe(true);
        });

        test('the overlay explains the pause', async ({ page }) => {
            await page.evaluate(() => startGame());
            await page.keyboard.press('p');
            await expect(page.locator('#overlay')).toHaveClass(/visible/);
            await expect(page.locator('#overlay-title')).toContainText(/pause/i);
        });

        test('firing while paused is ignored', async ({ page }) => {
            await page.evaluate(() => startGame());
            await page.keyboard.press('p');
            const after = await page.evaluate(() => { fire(); return { state, vy: ball.vy }; });
            expect(after.state).toBe('paused');
            expect(after.vy).toBe(0);
        });
    });

    // -----------------------------------------------------------------------
    // Rendering
    // -----------------------------------------------------------------------
    test.describe('rendering', () => {
        test('the board is drawn without errors', async ({ page }) => {
            const errors = [];
            page.on('pageerror', (e) => errors.push(e.message));
            await page.evaluate(() => { startGame(); fire(); for (let i = 0; i < 60; i++) { step(1 / 60); draw(); } });
            expect(errors).toEqual([]);
        });

        test('the canvas has ink on it after a draw', async ({ page }) => {
            const painted = await page.evaluate(() => {
                startGame();
                draw();
                const data = canvas.getContext('2d').getImageData(0, 0, CANVAS_W, CANVAS_H).data;
                let lit = 0;
                for (let i = 3; i < data.length; i += 4) if (data[i] > 0) lit++;
                return lit;
            });
            expect(painted).toBeGreaterThan(1000);
        });
    });
});
