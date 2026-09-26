const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');

const GAME_URL = pathToFileURL(path.resolve(__dirname, '../index.html')).href;
const REPO_ROOT = path.resolve(__dirname, '../..');

// Start a level and freeze the animation loop so a test can place the ball
// itself and advance the simulation one deterministic step at a time.
async function startFrozen(page) {
    await page.evaluate(() => {
        startGame();
        autoRun = false;
    });
}

// Replace the board with exactly the pegs a test cares about.
async function setPegs(page, pegs) {
    await page.evaluate((list) => {
        pegs.length = 0;
        list.forEach((p) => pegs.push({ x: p.x, y: p.y, type: p.type }));
    }, pegs);
}

// Put a ball in flight at a known position and velocity.
async function placeBall(page, ballState) {
    await page.evaluate((b) => {
        ball = { x: b.x, y: b.y, vx: b.vx, vy: b.vy, age: 0 };
    }, ballState);
}

// Advance the frozen simulation by `steps` fixed timesteps.
async function step(page, steps = 1) {
    await page.evaluate((n) => {
        for (let i = 0; i < n; i++) physicsStep(1 / 120);
    }, steps);
}

// Park the bucket far from the action so it cannot catch a falling test ball.
async function parkBucket(page) {
    await page.evaluate(() => {
        bucket.x = 0;
        bucket.speed = 0;
    });
}

test.describe('Peg Pop', () => {
    test.beforeEach(async ({ page }) => {
        await page.goto(GAME_URL);
    });

    // -----------------------------------------------------------------------
    // Initial / idle state
    // -----------------------------------------------------------------------
    test.describe('initial state', () => {
        test('page title is Peg Pop', async ({ page }) => {
            await expect(page).toHaveTitle('Peg Pop');
        });

        test('canvas is 480x640', async ({ page }) => {
            const canvas = page.locator('#canvas');
            await expect(canvas).toHaveAttribute('width', '480');
            await expect(canvas).toHaveAttribute('height', '640');
        });

        test('start overlay is visible', async ({ page }) => {
            await expect(page.locator('#overlay')).toHaveClass(/visible/);
        });

        test('overlay prompts the player to start', async ({ page }) => {
            await expect(page.locator('#overlay-sub')).toContainText(/space|start/i);
        });

        test('HUD shows starting values', async ({ page }) => {
            await expect(page.locator('#score')).toHaveText('0');
            await expect(page.locator('#level')).toHaveText('1');
            await expect(page.locator('#balls')).toHaveText('10');
            await expect(page.locator('#best')).toHaveText('0');
        });

        test('state is idle before starting', async ({ page }) => {
            expect(await page.evaluate(() => state)).toBe('idle');
        });

        test('no pegs and no ball before starting', async ({ page }) => {
            expect(await page.evaluate(() => pegs.length)).toBe(0);
            expect(await page.evaluate(() => ball)).toBeNull();
        });

        test('best score loads from localStorage', async ({ page }) => {
            await page.evaluate(() => window.localStorage.setItem('pegpop-best', '7350'));
            await page.reload();
            await expect(page.locator('#best')).toHaveText('7350');
        });

        test('the help legend explains aiming and firing', async ({ page }) => {
            await expect(page.locator('.help')).toContainText(/aim/i);
            await expect(page.locator('.help')).toContainText(/fire/i);
        });
    });

    // -----------------------------------------------------------------------
    // Starting a game
    // -----------------------------------------------------------------------
    test.describe('starting', () => {
        test('Space starts the game', async ({ page }) => {
            await page.keyboard.press('Space');
            expect(await page.evaluate(() => state)).toBe('running');
        });

        test('the Start button starts the game', async ({ page }) => {
            await page.locator('#btn-start').click();
            expect(await page.evaluate(() => state)).toBe('running');
        });

        test('overlay hides once running', async ({ page }) => {
            await page.keyboard.press('Space');
            await expect(page.locator('#overlay')).not.toHaveClass(/visible/);
        });

        test('level 1 puts pegs on the board', async ({ page }) => {
            await startFrozen(page);
            expect(await page.evaluate(() => pegs.length)).toBeGreaterThan(20);
        });

        test('every peg sits inside the playfield', async ({ page }) => {
            await startFrozen(page);
            const inside = await page.evaluate(() =>
                pegs.every((p) => p.x > PEG_R && p.x < W - PEG_R && p.y > 120 && p.y < H - 80)
            );
            expect(inside).toBe(true);
        });

        test('the board has orange target pegs', async ({ page }) => {
            await startFrozen(page);
            expect(await page.evaluate(() => orangesLeft())).toBeGreaterThan(0);
        });

        test('the board has exactly one green peg', async ({ page }) => {
            await startFrozen(page);
            const greens = await page.evaluate(() => pegs.filter((p) => p.type === 'green').length);
            expect(greens).toBe(1);
        });

        test('pegs only use the three known types', async ({ page }) => {
            await startFrozen(page);
            const known = await page.evaluate(() =>
                pegs.every((p) => ['blue', 'orange', 'green'].includes(p.type))
            );
            expect(known).toBe(true);
        });

        test('the player starts with ten balls and no ball in flight', async ({ page }) => {
            await startFrozen(page);
            expect(await page.evaluate(() => ballsLeft)).toBe(10);
            expect(await page.evaluate(() => ball)).toBeNull();
        });

        test('the launcher starts aimed straight down at the top centre', async ({ page }) => {
            await startFrozen(page);
            const l = await page.evaluate(() => ({ x: launcher.x, y: launcher.y, angle: launcher.angle }));
            expect(l.x).toBeCloseTo(240, 5);
            expect(l.y).toBeCloseTo(40, 5);
            expect(l.angle).toBeCloseTo(0, 5);
        });

        test('the HUD reports the orange pegs left to clear', async ({ page }) => {
            await startFrozen(page);
            const oranges = await page.evaluate(() => orangesLeft());
            await expect(page.locator('#pegs')).toHaveText(String(oranges));
        });
    });

    // -----------------------------------------------------------------------
    // Aiming
    // -----------------------------------------------------------------------
    test.describe('aiming', () => {
        test.beforeEach(async ({ page }) => {
            await startFrozen(page);
        });

        test('ArrowRight swings the launcher right', async ({ page }) => {
            await page.keyboard.press('ArrowRight');
            expect(await page.evaluate(() => launcher.angle)).toBeGreaterThan(0);
        });

        test('ArrowLeft swings the launcher left', async ({ page }) => {
            await page.keyboard.press('ArrowLeft');
            expect(await page.evaluate(() => launcher.angle)).toBeLessThan(0);
        });

        test('D and A also aim', async ({ page }) => {
            await page.keyboard.press('KeyD');
            const right = await page.evaluate(() => launcher.angle);
            expect(right).toBeGreaterThan(0);
            await page.keyboard.press('KeyA');
            await page.keyboard.press('KeyA');
            expect(await page.evaluate(() => launcher.angle)).toBeLessThan(right);
        });

        test('aim cannot swing past the right limit', async ({ page }) => {
            await page.evaluate(() => setAim(99));
            expect(await page.evaluate(() => launcher.angle)).toBeCloseTo(await page.evaluate(() => AIM_LIMIT), 5);
        });

        test('aim cannot swing past the left limit', async ({ page }) => {
            await page.evaluate(() => setAim(-99));
            const limit = await page.evaluate(() => AIM_LIMIT);
            expect(await page.evaluate(() => launcher.angle)).toBeCloseTo(-limit, 5);
        });

        test('holding an aim key sweeps the launcher while the sim runs', async ({ page }) => {
            await page.evaluate(() => setAim(0));
            await page.keyboard.down('ArrowRight');
            const afterTap = await page.evaluate(() => launcher.angle);
            await step(page, 60);
            await page.keyboard.up('ArrowRight');
            expect(await page.evaluate(() => launcher.angle)).toBeGreaterThan(afterTap);
        });

        test('moving the mouse left of centre aims left', async ({ page }) => {
            const box = await page.locator('#canvas').boundingBox();
            await page.mouse.move(box.x + 60, box.y + 400);
            expect(await page.evaluate(() => launcher.angle)).toBeLessThan(0);
        });

        test('moving the mouse right of centre aims right', async ({ page }) => {
            const box = await page.locator('#canvas').boundingBox();
            await page.mouse.move(box.x + 420, box.y + 400);
            expect(await page.evaluate(() => launcher.angle)).toBeGreaterThan(0);
        });

        test('mouse aim is clamped to the aim limit', async ({ page }) => {
            const box = await page.locator('#canvas').boundingBox();
            await page.mouse.move(box.x + 479, box.y + 41);
            const angle = await page.evaluate(() => launcher.angle);
            const limit = await page.evaluate(() => AIM_LIMIT);
            expect(angle).toBeLessThanOrEqual(limit + 1e-9);
            expect(angle).toBeGreaterThan(0);
        });
    });

    // -----------------------------------------------------------------------
    // Firing
    // -----------------------------------------------------------------------
    test.describe('firing', () => {
        test.beforeEach(async ({ page }) => {
            await startFrozen(page);
        });

        test('Space fires a ball', async ({ page }) => {
            await page.keyboard.press('Space');
            expect(await page.evaluate(() => ball !== null)).toBe(true);
        });

        test('clicking the canvas fires a ball', async ({ page }) => {
            await page.locator('#canvas').click({ position: { x: 240, y: 500 } });
            expect(await page.evaluate(() => ball !== null)).toBe(true);
        });

        test('firing spends a ball', async ({ page }) => {
            await page.evaluate(() => fireBall());
            expect(await page.evaluate(() => ballsLeft)).toBe(9);
            await expect(page.locator('#balls')).toHaveText('9');
        });

        test('a fired ball leaves the launcher muzzle', async ({ page }) => {
            await page.evaluate(() => fireBall());
            const b = await page.evaluate(() => ({ x: ball.x, y: ball.y }));
            expect(b.x).toBeCloseTo(240, 5);
            expect(b.y).toBeGreaterThanOrEqual(40);
            expect(b.y).toBeLessThan(80);
        });

        test('a ball fired straight down has no sideways speed', async ({ page }) => {
            await page.evaluate(() => {
                setAim(0);
                fireBall();
            });
            const b = await page.evaluate(() => ({ vx: ball.vx, vy: ball.vy }));
            expect(b.vx).toBeCloseTo(0, 5);
            expect(b.vy).toBeCloseTo(await page.evaluate(() => LAUNCH_SPEED), 5);
        });

        test('aiming right sends the ball right', async ({ page }) => {
            await page.evaluate(() => {
                setAim(0.6);
                fireBall();
            });
            expect(await page.evaluate(() => ball.vx)).toBeGreaterThan(0);
            expect(await page.evaluate(() => ball.vy)).toBeGreaterThan(0);
        });

        test('aiming left sends the ball left', async ({ page }) => {
            await page.evaluate(() => {
                setAim(-0.6);
                fireBall();
            });
            expect(await page.evaluate(() => ball.vx)).toBeLessThan(0);
        });

        test('firing while a ball is in flight does nothing', async ({ page }) => {
            await page.evaluate(() => fireBall());
            await page.evaluate(() => fireBall());
            expect(await page.evaluate(() => ballsLeft)).toBe(9);
        });

        test('firing with no balls left does nothing', async ({ page }) => {
            await page.evaluate(() => {
                ballsLeft = 0;
                fireBall();
            });
            expect(await page.evaluate(() => ball)).toBeNull();
            expect(await page.evaluate(() => ballsLeft)).toBe(0);
        });
    });

    // -----------------------------------------------------------------------
    // Physics
    // -----------------------------------------------------------------------
    test.describe('physics', () => {
        test.beforeEach(async ({ page }) => {
            await startFrozen(page);
            await setPegs(page, []);
            await parkBucket(page);
        });

        test('gravity accelerates the ball downward', async ({ page }) => {
            await placeBall(page, { x: 240, y: 200, vx: 0, vy: 0 });
            await step(page, 12);
            const b = await page.evaluate(() => ({ vy: ball.vy, y: ball.y }));
            expect(b.vy).toBeCloseTo((520 * 12) / 120, 1);
            expect(b.y).toBeGreaterThan(200);
        });

        test('a ball with sideways speed drifts sideways', async ({ page }) => {
            await placeBall(page, { x: 240, y: 200, vx: 90, vy: 0 });
            await step(page, 30);
            expect(await page.evaluate(() => ball.x)).toBeGreaterThan(240);
        });

        test('the left wall bounces the ball back', async ({ page }) => {
            await placeBall(page, { x: 7, y: 300, vx: -150, vy: 0 });
            await step(page, 2);
            const b = await page.evaluate(() => ({ x: ball.x, vx: ball.vx }));
            expect(b.vx).toBeGreaterThan(0);
            expect(b.x).toBeGreaterThanOrEqual(await page.evaluate(() => BALL_R));
        });

        test('the right wall bounces the ball back', async ({ page }) => {
            const w = await page.evaluate(() => W);
            await placeBall(page, { x: w - 7, y: 300, vx: 150, vy: 0 });
            await step(page, 2);
            const b = await page.evaluate(() => ({ x: ball.x, vx: ball.vx }));
            expect(b.vx).toBeLessThan(0);
            expect(b.x).toBeLessThanOrEqual(w - (await page.evaluate(() => BALL_R)));
        });

        test('walls damp the bounce instead of adding energy', async ({ page }) => {
            await placeBall(page, { x: 8, y: 300, vx: -200, vy: 0 });
            await step(page, 2);
            expect(Math.abs(await page.evaluate(() => ball.vx))).toBeLessThan(200);
        });

        test('the top wall bounces the ball back down', async ({ page }) => {
            await placeBall(page, { x: 240, y: 7, vx: 0, vy: -150 });
            await step(page, 2);
            expect(await page.evaluate(() => ball.vy)).toBeGreaterThan(0);
        });

        test('the ball is removed when it falls past the bottom', async ({ page }) => {
            await placeBall(page, { x: 240, y: 630, vx: 0, vy: 300 });
            await step(page, 30);
            expect(await page.evaluate(() => ball)).toBeNull();
        });

        test('a shot that never ends is cut off by the time limit', async ({ page }) => {
            await page.evaluate(() => {
                ball = { x: 240, y: 300, vx: 0, vy: 0, age: SHOT_TIME_LIMIT - 0.01 };
            });
            await step(page, 4);
            expect(await page.evaluate(() => ball)).toBeNull();
        });

        test('the bucket slides along the bottom and turns at the walls', async ({ page }) => {
            const moved = await page.evaluate(() => {
                bucket.x = 20;
                bucket.dir = -1;
                bucket.speed = 120;
                const before = bucket.x;
                for (let i = 0; i < 60; i++) physicsStep(1 / 120);
                return { before, after: bucket.x, dir: bucket.dir };
            });
            expect(moved.after).not.toBeCloseTo(moved.before, 3);
            expect(moved.dir).toBe(1);
            expect(moved.after).toBeGreaterThanOrEqual(0);
        });

        test('the bucket stays inside the playfield', async ({ page }) => {
            const ok = await page.evaluate(() => {
                bucket.x = 300;
                bucket.speed = 200;
                for (let i = 0; i < 1200; i++) {
                    physicsStep(1 / 120);
                    if (bucket.x < 0 || bucket.x + bucket.w > W) return false;
                }
                return true;
            });
            expect(ok).toBe(true);
        });
    });

    // -----------------------------------------------------------------------
    // Peg collisions and scoring
    // -----------------------------------------------------------------------
    test.describe('peg collisions', () => {
        test.beforeEach(async ({ page }) => {
            await startFrozen(page);
            await parkBucket(page);
        });

        test('hitting a blue peg removes it and scores 10', async ({ page }) => {
            await setPegs(page, [{ x: 240, y: 320, type: 'blue' }]);
            await placeBall(page, { x: 240, y: 280, vx: 0, vy: 200 });
            await step(page, 30);
            expect(await page.evaluate(() => pegs.length)).toBe(0);
            expect(await page.evaluate(() => score)).toBe(10);
        });

        test('hitting an orange peg scores 100', async ({ page }) => {
            await setPegs(page, [
                { x: 240, y: 320, type: 'orange' },
                { x: 100, y: 500, type: 'orange' },
            ]);
            await placeBall(page, { x: 240, y: 280, vx: 0, vy: 200 });
            await step(page, 30);
            expect(await page.evaluate(() => score)).toBe(100);
            expect(await page.evaluate(() => orangesLeft())).toBe(1);
        });

        test('hitting a green peg scores 50 and refunds a ball', async ({ page }) => {
            await setPegs(page, [
                { x: 240, y: 320, type: 'green' },
                { x: 100, y: 500, type: 'orange' },
            ]);
            await page.evaluate(() => {
                ballsLeft = 4;
            });
            await placeBall(page, { x: 240, y: 280, vx: 0, vy: 200 });
            await step(page, 30);
            expect(await page.evaluate(() => score)).toBe(50);
            expect(await page.evaluate(() => ballsLeft)).toBe(5);
        });

        test('a peg bounces the ball back upward', async ({ page }) => {
            await setPegs(page, [{ x: 240, y: 320, type: 'blue' }]);
            await placeBall(page, { x: 240, y: 280, vx: 0, vy: 200 });
            await step(page, 30);
            expect(await page.evaluate(() => ball.vy)).toBeLessThan(0);
        });

        test('a peg bounce damps the ball instead of adding energy', async ({ page }) => {
            await setPegs(page, [{ x: 240, y: 320, type: 'blue' }]);
            await placeBall(page, { x: 240, y: 300, vx: 0, vy: 200 });
            await step(page, 8);
            const speed = await page.evaluate(() => Math.hypot(ball.vx, ball.vy));
            expect(speed).toBeLessThan(200);
        });

        test('an off-centre hit deflects the ball sideways', async ({ page }) => {
            await setPegs(page, [{ x: 250, y: 320, type: 'blue' }]);
            await placeBall(page, { x: 240, y: 300, vx: 0, vy: 200 });
            await step(page, 6);
            expect(await page.evaluate(() => ball.vx)).toBeLessThan(0);
        });

        test('the ball is pushed clear of the peg it hits', async ({ page }) => {
            await setPegs(page, [{ x: 240, y: 320, type: 'blue' }]);
            await placeBall(page, { x: 240, y: 300, vx: 0, vy: 200 });
            await step(page, 8);
            const d = await page.evaluate(() => Math.hypot(ball.x - 240, ball.y - 320));
            expect(d).toBeGreaterThanOrEqual(await page.evaluate(() => BALL_R + PEG_R - 0.001));
        });

        test('a ball passing wide of a peg does not clear it', async ({ page }) => {
            await setPegs(page, [{ x: 100, y: 320, type: 'blue' }]);
            await placeBall(page, { x: 300, y: 280, vx: 0, vy: 200 });
            await step(page, 60);
            expect(await page.evaluate(() => pegs.length)).toBe(1);
            expect(await page.evaluate(() => score)).toBe(0);
        });

        test('one shot can clear several pegs in a row', async ({ page }) => {
            await setPegs(page, [
                { x: 240, y: 260, type: 'blue' },
                { x: 240, y: 340, type: 'blue' },
                { x: 240, y: 420, type: 'blue' },
            ]);
            await placeBall(page, { x: 240, y: 200, vx: 0, vy: 400 });
            await step(page, 600);
            expect(await page.evaluate(() => score)).toBeGreaterThanOrEqual(20);
        });

        test('the orange counter in the HUD follows the board', async ({ page }) => {
            await setPegs(page, [
                { x: 240, y: 320, type: 'orange' },
                { x: 100, y: 500, type: 'orange' },
            ]);
            await placeBall(page, { x: 240, y: 280, vx: 0, vy: 200 });
            await step(page, 30);
            await expect(page.locator('#pegs')).toHaveText('1');
        });

        test('the score in the HUD follows the score', async ({ page }) => {
            await setPegs(page, [
                { x: 240, y: 320, type: 'blue' },
                { x: 100, y: 500, type: 'orange' },
            ]);
            await placeBall(page, { x: 240, y: 280, vx: 0, vy: 200 });
            await step(page, 30);
            await expect(page.locator('#score')).toHaveText('10');
        });
    });

    // -----------------------------------------------------------------------
    // The free-ball bucket
    // -----------------------------------------------------------------------
    test.describe('free-ball bucket', () => {
        test.beforeEach(async ({ page }) => {
            await startFrozen(page);
            await setPegs(page, [{ x: 100, y: 300, type: 'orange' }]);
        });

        test('a ball caught in the bucket is refunded', async ({ page }) => {
            const refunded = await page.evaluate(() => {
                ballsLeft = 5;
                bucket.speed = 0;
                bucket.x = 240 - bucket.w / 2;
                ball = { x: 240, y: bucket.y - 4, vx: 0, vy: 200, age: 0 };
                for (let i = 0; i < 30 && ball; i++) physicsStep(1 / 120);
                return { ballsLeft, ball, catches: bucket.catches };
            });
            expect(refunded.ballsLeft).toBe(6);
            expect(refunded.ball).toBeNull();
            expect(refunded.catches).toBe(1);
        });

        test('a catch keeps the game running', async ({ page }) => {
            await page.evaluate(() => {
                ballsLeft = 0;
                bucket.speed = 0;
                bucket.x = 240 - bucket.w / 2;
                ball = { x: 240, y: bucket.y - 4, vx: 0, vy: 200, age: 0 };
                for (let i = 0; i < 30 && ball; i++) physicsStep(1 / 120);
            });
            expect(await page.evaluate(() => state)).toBe('running');
            expect(await page.evaluate(() => ballsLeft)).toBe(1);
        });

        test('a ball that misses the bucket is not refunded', async ({ page }) => {
            const missed = await page.evaluate(() => {
                ballsLeft = 5;
                bucket.speed = 0;
                bucket.x = 0;
                ball = { x: 460, y: bucket.y - 4, vx: 0, vy: 300, age: 0 };
                for (let i = 0; i < 60 && ball; i++) physicsStep(1 / 120);
                return { ballsLeft, ball };
            });
            expect(missed.ballsLeft).toBe(5);
            expect(missed.ball).toBeNull();
        });

        test('a catch does not award points', async ({ page }) => {
            const after = await page.evaluate(() => {
                bucket.speed = 0;
                bucket.x = 240 - bucket.w / 2;
                ball = { x: 240, y: bucket.y - 4, vx: 0, vy: 200, age: 0 };
                for (let i = 0; i < 30 && ball; i++) physicsStep(1 / 120);
                return score;
            });
            expect(after).toBe(0);
        });
    });

    // -----------------------------------------------------------------------
    // Level progress
    // -----------------------------------------------------------------------
    test.describe('level progress', () => {
        test.beforeEach(async ({ page }) => {
            await startFrozen(page);
            await parkBucket(page);
        });

        test('clearing the last orange peg clears the level', async ({ page }) => {
            await setPegs(page, [{ x: 240, y: 320, type: 'orange' }]);
            await placeBall(page, { x: 240, y: 300, vx: 0, vy: 260 });
            await step(page, 400);
            expect(await page.evaluate(() => pegs.length)).toBe(0);
            expect(await page.evaluate(() => state)).toBe('levelclear');
        });

        test('clearing a level shows an overlay', async ({ page }) => {
            await page.evaluate(() => {
                pegs.length = 0;
                ball = { x: 240, y: 630, vx: 0, vy: 300, age: 0 };
                for (let i = 0; i < 30 && ball; i++) physicsStep(1 / 120);
            });
            await expect(page.locator('#overlay')).toHaveClass(/visible/);
            await expect(page.locator('#overlay-title')).toContainText(/clear|complete/i);
        });

        test('clearing a level pays a bonus for the balls still in hand', async ({ page }) => {
            const scored = await page.evaluate(() => {
                pegs.length = 0;
                score = 0;
                ballsLeft = 4;
                ball = { x: 240, y: 630, vx: 0, vy: 300, age: 0 };
                for (let i = 0; i < 30 && ball; i++) physicsStep(1 / 120);
                return score;
            });
            expect(scored).toBe(1000);
        });

        test('Space moves on to the next level', async ({ page }) => {
            await page.evaluate(() => {
                pegs.length = 0;
                ball = { x: 240, y: 700, vx: 0, vy: 300, age: 0 };
                for (let i = 0; i < 30 && ball; i++) physicsStep(1 / 120);
            });
            expect(await page.evaluate(() => state)).toBe('levelclear');
            await page.keyboard.press('Space');
            expect(await page.evaluate(() => state)).toBe('running');
            expect(await page.evaluate(() => level)).toBe(2);
        });

        test('the next level brings a fresh board and ten balls', async ({ page }) => {
            const before = await page.evaluate(() => pegs.map((p) => `${p.x},${p.y}`).join('|'));
            await page.evaluate(() => {
                pegs.length = 0;
                ballsLeft = 2;
                ball = { x: 240, y: 700, vx: 0, vy: 300, age: 0 };
                for (let i = 0; i < 30 && ball; i++) physicsStep(1 / 120);
                advance();
                autoRun = false;
            });
            const after = await page.evaluate(() => pegs.map((p) => `${p.x},${p.y}`).join('|'));
            expect(after).not.toBe(before);
            expect(await page.evaluate(() => ballsLeft)).toBe(10);
            expect(await page.evaluate(() => orangesLeft())).toBeGreaterThan(0);
        });

        test('score carries across levels', async ({ page }) => {
            await page.evaluate(() => {
                score = 555;
                ballsLeft = 0;
                pegs.length = 0;
                ball = { x: 240, y: 700, vx: 0, vy: 300, age: 0 };
                for (let i = 0; i < 30 && ball; i++) physicsStep(1 / 120);
                advance();
                autoRun = false;
            });
            expect(await page.evaluate(() => score)).toBe(555);
        });

        test('later levels have at least as many orange pegs', async ({ page }) => {
            const counts = await page.evaluate(() => {
                const out = [];
                for (let n = 1; n <= LEVEL_COUNT; n++) {
                    out.push(buildLevel(n).filter((p) => p.type === 'orange').length);
                }
                return out;
            });
            expect(counts).toHaveLength(5);
            counts.forEach((c) => expect(c).toBeGreaterThan(0));
            expect(counts[counts.length - 1]).toBeGreaterThanOrEqual(counts[0]);
        });

        test('every level is a distinct board with one green peg', async ({ page }) => {
            const info = await page.evaluate(() => {
                const shapes = new Set();
                const greens = [];
                for (let n = 1; n <= LEVEL_COUNT; n++) {
                    const board = buildLevel(n);
                    shapes.add(board.map((p) => `${p.x},${p.y}`).join('|'));
                    greens.push(board.filter((p) => p.type === 'green').length);
                }
                return { shapes: shapes.size, greens };
            });
            expect(info.shapes).toBe(5);
            expect(info.greens).toEqual([1, 1, 1, 1, 1]);
        });

        test('clearing the final level wins the game', async ({ page }) => {
            await page.evaluate(() => {
                level = LEVEL_COUNT;
                pegs.length = 0;
                ball = { x: 240, y: 700, vx: 0, vy: 300, age: 0 };
                for (let i = 0; i < 30 && ball; i++) physicsStep(1 / 120);
            });
            expect(await page.evaluate(() => state)).toBe('won');
            await expect(page.locator('#overlay-title')).toContainText(/win|won|victor/i);
        });
    });

    // -----------------------------------------------------------------------
    // Losing and restarting
    // -----------------------------------------------------------------------
    test.describe('game over', () => {
        test.beforeEach(async ({ page }) => {
            await startFrozen(page);
            await parkBucket(page);
        });

        test('running out of balls with oranges left ends the game', async ({ page }) => {
            await page.evaluate(() => {
                ballsLeft = 0;
                ball = { x: 240, y: 700, vx: 0, vy: 300, age: 0 };
                for (let i = 0; i < 30 && ball; i++) physicsStep(1 / 120);
            });
            expect(await page.evaluate(() => state)).toBe('gameover');
        });

        test('game over shows the overlay with the final score', async ({ page }) => {
            await page.evaluate(() => {
                score = 1234;
                ballsLeft = 0;
                ball = { x: 240, y: 700, vx: 0, vy: 300, age: 0 };
                for (let i = 0; i < 30 && ball; i++) physicsStep(1 / 120);
            });
            await expect(page.locator('#overlay')).toHaveClass(/visible/);
            await expect(page.locator('#overlay-title')).toContainText(/over/i);
            await expect(page.locator('#overlay-score')).toContainText('1234');
        });

        test('a game over saves a new best score', async ({ page }) => {
            await page.evaluate(() => {
                score = 4321;
                ballsLeft = 0;
                ball = { x: 240, y: 700, vx: 0, vy: 300, age: 0 };
                for (let i = 0; i < 30 && ball; i++) physicsStep(1 / 120);
            });
            await expect(page.locator('#best')).toHaveText('4321');
            expect(await page.evaluate(() => window.localStorage.getItem('pegpop-best'))).toBe('4321');
        });

        test('a weaker run does not lower the best score', async ({ page }) => {
            await page.evaluate(() => window.localStorage.setItem('pegpop-best', '9000'));
            await page.reload();
            await startFrozen(page);
            await page.evaluate(() => {
                score = 100;
                ballsLeft = 0;
                ball = { x: 240, y: 700, vx: 0, vy: 300, age: 0 };
                for (let i = 0; i < 30 && ball; i++) physicsStep(1 / 120);
            });
            await expect(page.locator('#best')).toHaveText('9000');
            expect(await page.evaluate(() => window.localStorage.getItem('pegpop-best'))).toBe('9000');
        });

        test('firing after a game over does nothing', async ({ page }) => {
            await page.evaluate(() => {
                ballsLeft = 0;
                ball = { x: 240, y: 700, vx: 0, vy: 300, age: 0 };
                for (let i = 0; i < 30 && ball; i++) physicsStep(1 / 120);
                fireBall();
            });
            expect(await page.evaluate(() => ball)).toBeNull();
        });

        test('Space starts a fresh run after a game over', async ({ page }) => {
            await page.evaluate(() => {
                score = 800;
                level = 3;
                ballsLeft = 0;
                ball = { x: 240, y: 700, vx: 0, vy: 300, age: 0 };
                for (let i = 0; i < 30 && ball; i++) physicsStep(1 / 120);
            });
            await page.keyboard.press('Space');
            expect(await page.evaluate(() => state)).toBe('running');
            expect(await page.evaluate(() => score)).toBe(0);
            expect(await page.evaluate(() => level)).toBe(1);
            expect(await page.evaluate(() => ballsLeft)).toBe(10);
        });

        test('the Start button restarts after a game over', async ({ page }) => {
            await page.evaluate(() => {
                ballsLeft = 0;
                ball = { x: 240, y: 700, vx: 0, vy: 300, age: 0 };
                for (let i = 0; i < 30 && ball; i++) physicsStep(1 / 120);
            });
            await page.locator('#btn-start').click();
            expect(await page.evaluate(() => state)).toBe('running');
        });
    });

    // -----------------------------------------------------------------------
    // Pausing
    // -----------------------------------------------------------------------
    test.describe('pausing', () => {
        test('P pauses a running game', async ({ page }) => {
            await page.keyboard.press('Space');
            await page.keyboard.press('KeyP');
            expect(await page.evaluate(() => state)).toBe('paused');
            await expect(page.locator('#overlay')).toHaveClass(/visible/);
            await expect(page.locator('#overlay-title')).toContainText(/pause/i);
        });

        test('P unpauses', async ({ page }) => {
            await page.keyboard.press('Space');
            await page.keyboard.press('KeyP');
            await page.keyboard.press('KeyP');
            expect(await page.evaluate(() => state)).toBe('running');
            await expect(page.locator('#overlay')).not.toHaveClass(/visible/);
        });

        test('a paused game does not simulate', async ({ page }) => {
            await page.keyboard.press('Space');
            await page.evaluate(() => {
                fireBall();
                togglePause();
            });
            const before = await page.evaluate(() => ({ x: ball.x, y: ball.y }));
            await page.waitForTimeout(250);
            const after = await page.evaluate(() => ({ x: ball.x, y: ball.y }));
            expect(after).toEqual(before);
        });

        test('a running game does simulate on its own', async ({ page }) => {
            await page.keyboard.press('Space');
            await page.evaluate(() => fireBall());
            const before = await page.evaluate(() => ball.y);
            await page.waitForTimeout(200);
            const after = await page.evaluate(() => (ball ? ball.y : 9999));
            expect(after).toBeGreaterThan(before);
        });

        test('P does nothing before the game starts', async ({ page }) => {
            await page.keyboard.press('KeyP');
            expect(await page.evaluate(() => state)).toBe('idle');
        });

        test('firing while paused does nothing', async ({ page }) => {
            await page.keyboard.press('Space');
            await page.evaluate(() => togglePause());
            await page.evaluate(() => fireBall());
            expect(await page.evaluate(() => ball)).toBeNull();
        });
    });

    // -----------------------------------------------------------------------
    // Rendering
    // -----------------------------------------------------------------------
    test.describe('rendering', () => {
        test('the idle screen draws something', async ({ page }) => {
            const painted = await page.evaluate(() => {
                const data = canvas.getContext('2d').getImageData(0, 0, W, H).data;
                let lit = 0;
                for (let i = 0; i < data.length; i += 4) {
                    if (data[i] + data[i + 1] + data[i + 2] > 90) lit++;
                }
                return lit;
            });
            expect(painted).toBeGreaterThan(0);
        });

        test('pegs are drawn once a level starts', async ({ page }) => {
            const before = await page.evaluate(() => {
                const d = canvas.getContext('2d').getImageData(0, 150, W, 380).data;
                let lit = 0;
                for (let i = 0; i < d.length; i += 4) if (d[i] + d[i + 1] + d[i + 2] > 150) lit++;
                return lit;
            });
            await page.keyboard.press('Space');
            await page.waitForTimeout(120);
            const after = await page.evaluate(() => {
                const d = canvas.getContext('2d').getImageData(0, 150, W, 380).data;
                let lit = 0;
                for (let i = 0; i < d.length; i += 4) if (d[i] + d[i + 1] + d[i + 2] > 150) lit++;
                return lit;
            });
            expect(after).toBeGreaterThan(before);
        });

        test('the canvas keeps repainting while a ball flies', async ({ page }) => {
            await page.keyboard.press('Space');
            await page.evaluate(() => {
                setAim(0);
                fireBall();
            });
            const first = await page.locator('#canvas').screenshot();
            await page.waitForTimeout(150);
            const second = await page.locator('#canvas').screenshot();
            expect(Buffer.compare(first, second)).not.toBe(0);
        });
    });

    // -----------------------------------------------------------------------
    // A real, unassisted game
    // -----------------------------------------------------------------------
    test.describe('playing for real', () => {
        test('ten unaided shots spend ten balls and score points', async ({ page }) => {
            const result = await page.evaluate(async () => {
                startGame();
                autoRun = false;
                const aims = [-0.9, -0.6, -0.35, -0.15, 0, 0.15, 0.35, 0.6, 0.9, 0.45];
                let shots = 0;
                for (const a of aims) {
                    if (state !== 'running' || ballsLeft === 0) break;
                    setAim(a);
                    fireBall();
                    shots++;
                    let guard = 0;
                    while (ball && guard++ < 6000) physicsStep(1 / 120);
                }
                return { shots, score, state, oranges: orangesLeft() };
            });
            expect(result.shots).toBeGreaterThanOrEqual(3);
            expect(result.score).toBeGreaterThan(0);
            expect(['running', 'levelclear', 'gameover']).toContain(result.state);
        });

        test('no shot leaves the ball stuck on the board', async ({ page }) => {
            const stuck = await page.evaluate(() => {
                startGame();
                autoRun = false;
                for (const a of [-0.8, -0.4, 0, 0.4, 0.8]) {
                    if (state !== 'running') break;
                    setAim(a);
                    fireBall();
                    let guard = 0;
                    while (ball && guard++ < 6000) physicsStep(1 / 120);
                    if (ball) return a;
                }
                return null;
            });
            expect(stuck).toBeNull();
        });

        test('a full level of shots never puts the ball outside the canvas', async ({ page }) => {
            const escaped = await page.evaluate(() => {
                startGame();
                autoRun = false;
                for (const a of [-1.1, -0.5, 0.2, 1.1]) {
                    setAim(a);
                    fireBall();
                    let guard = 0;
                    while (ball && guard++ < 6000) {
                        physicsStep(1 / 120);
                        if (ball && (ball.x < -1 || ball.x > W + 1 || ball.y < -1)) return { x: ball.x, y: ball.y };
                    }
                }
                return null;
            });
            expect(escaped).toBeNull();
        });
    });

    // -----------------------------------------------------------------------
    // Game browser integration
    // -----------------------------------------------------------------------
    test.describe('game browser integration', () => {
        test('games.json lists Peg Pop', () => {
            const games = JSON.parse(
                fs.readFileSync(path.join(REPO_ROOT, 'game-browser/src/assets/games.json'), 'utf8')
            );
            const entry = games.find((g) => g.id === 'peg-pop');
            expect(entry).toBeTruthy();
            expect(entry.name).toBe('Peg Pop');
            expect(entry.dir).toBe('PegPop');
            expect(entry.path).toBe('games/PegPop/index.html');
            expect(entry.thumbnail).toBe('games/PegPop/screenshot.png');
            expect(entry.description.length).toBeGreaterThan(10);
        });

        test('the games.json entry stays alphabetically sorted by name', () => {
            const games = JSON.parse(
                fs.readFileSync(path.join(REPO_ROOT, 'game-browser/src/assets/games.json'), 'utf8')
            );
            const i = games.findIndex((g) => g.id === 'peg-pop');
            expect(i).toBeGreaterThan(0);
            expect(games[i - 1].name.localeCompare(games[i].name)).toBeLessThanOrEqual(0);
            if (i + 1 < games.length) {
                expect(games[i].name.localeCompare(games[i + 1].name)).toBeLessThanOrEqual(0);
            }
        });

        test('the thumbnail the browser points at exists', () => {
            expect(fs.existsSync(path.join(REPO_ROOT, 'PegPop/screenshot.png'))).toBe(true);
        });

        test('the root README lists the game', () => {
            const readme = fs.readFileSync(path.join(REPO_ROOT, 'README.md'), 'utf8');
            expect(readme).toMatch(/\|\s*Peg Pop\s*\|\s*\[PegPop\/\]\(PegPop\/\)\s*\|\s*(Complete|In Progress)\s*\|/);
        });

        test('the game ships its own README and DESIGN docs', () => {
            expect(fs.existsSync(path.join(REPO_ROOT, 'PegPop/README.md'))).toBe(true);
            expect(fs.existsSync(path.join(REPO_ROOT, 'PegPop/DESIGN.md'))).toBe(true);
        });
    });
});
