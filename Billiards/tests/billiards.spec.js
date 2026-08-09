const { test, expect } = require('@playwright/test');
const path = require('path');
const { pathToFileURL } = require('url');

const GAME_URL = pathToFileURL(path.resolve(__dirname, '../index.html')).href;

test.describe('Billiards', () => {
    test.beforeEach(async ({ page }) => {
        await page.goto(GAME_URL);
    });

    // -----------------------------------------------------------------------
    // Initial / idle state
    // -----------------------------------------------------------------------
    test.describe('initial state', () => {
        test('page title is Billiards', async ({ page }) => {
            await expect(page).toHaveTitle('Billiards');
        });

        test('start overlay is visible', async ({ page }) => {
            await expect(page.locator('#overlay')).toHaveClass(/visible/);
        });

        test('overlay prompts the player to start', async ({ page }) => {
            await expect(page.locator('#overlay-sub')).toContainText(/space|start/i);
        });

        test('score, shots and best start at 0', async ({ page }) => {
            await expect(page.locator('#score')).toHaveText('0');
            await expect(page.locator('#shots')).toHaveText('0');
            await expect(page.locator('#best')).toHaveText('0');
        });

        test('canvas is 720x400', async ({ page }) => {
            const canvas = page.locator('#canvas');
            await expect(canvas).toHaveAttribute('width', '720');
            await expect(canvas).toHaveAttribute('height', '400');
        });

        test('state is idle before starting', async ({ page }) => {
            expect(await page.evaluate(() => state)).toBe('idle');
        });

        test('there are six pockets', async ({ page }) => {
            expect(await page.evaluate(() => pockets.length)).toBe(6);
        });

        test('best score loads from localStorage', async ({ page }) => {
            await page.evaluate(() => window.localStorage.setItem('billiards-best', '742'));
            await page.reload();
            await expect(page.locator('#best')).toHaveText('742');
        });
    });

    // -----------------------------------------------------------------------
    // Starting a game / the rack
    // -----------------------------------------------------------------------
    test.describe('starting', () => {
        test('Space starts the game', async ({ page }) => {
            await page.keyboard.press('Space');
            expect(await page.evaluate(() => state)).toBe('ready');
            await expect(page.locator('#overlay')).not.toHaveClass(/visible/);
        });

        test('Start button starts the game', async ({ page }) => {
            await page.locator('#btn-start').click();
            expect(await page.evaluate(() => state)).toBe('ready');
        });

        test('a fresh game is rack 1 with no shots taken', async ({ page }) => {
            const s = await page.evaluate(() => { startGame(); return { racks, shots, score, state }; });
            expect(s.racks).toBe(1);
            expect(s.shots).toBe(0);
            expect(s.score).toBe(0);
            expect(s.state).toBe('ready');
        });

        test('the rack holds the cue ball plus ten object balls', async ({ page }) => {
            const counts = await page.evaluate(() => {
                startGame();
                return { total: balls.length, objects: objectBalls().length };
            });
            expect(counts.total).toBe(11);
            expect(counts.objects).toBe(10);
        });

        test('exactly one ball is the 8 ball', async ({ page }) => {
            const eights = await page.evaluate(() => {
                startGame();
                return balls.filter((b) => b.isEight).length;
            });
            expect(eights).toBe(1);
        });

        test('every ball starts inside the cushions', async ({ page }) => {
            const ok = await page.evaluate(() => {
                startGame();
                return balls.every((b) =>
                    b.x >= LEFT + BALL_R && b.x <= RIGHT - BALL_R &&
                    b.y >= TOP + BALL_R && b.y <= BOTTOM - BALL_R);
            });
            expect(ok).toBe(true);
        });

        test('no two balls overlap in a fresh rack', async ({ page }) => {
            const worst = await page.evaluate(() => {
                startGame();
                let min = Infinity;
                for (let i = 0; i < balls.length; i++) {
                    for (let j = i + 1; j < balls.length; j++) {
                        const d = Math.hypot(balls[i].x - balls[j].x, balls[i].y - balls[j].y);
                        if (d < min) min = d;
                    }
                }
                return min;
            });
            expect(worst).toBeGreaterThanOrEqual(18);
        });

        test('the cue ball is racked on the left half of the table', async ({ page }) => {
            const info = await page.evaluate(() => {
                startGame();
                return { x: cueBall.x, mid: (LEFT + RIGHT) / 2, isCue: cueBall.isCue };
            });
            expect(info.isCue).toBe(true);
            expect(info.x).toBeLessThan(info.mid);
        });

        test('no ball starts on top of a pocket', async ({ page }) => {
            const ok = await page.evaluate(() => {
                startGame();
                return balls.every((b) =>
                    pockets.every((p) => Math.hypot(b.x - p.x, b.y - p.y) > POCKET_R + BALL_R));
            });
            expect(ok).toBe(true);
        });
    });

    // -----------------------------------------------------------------------
    // Aiming and the power meter
    // -----------------------------------------------------------------------
    test.describe('aiming', () => {
        test('setAim sets the aim angle', async ({ page }) => {
            const a = await page.evaluate(() => { startGame(); setAim(1.25); return aimAngle; });
            expect(a).toBeCloseTo(1.25, 5);
        });

        test('aimAt points the cue at a table position', async ({ page }) => {
            const a = await page.evaluate(() => {
                startGame();
                aimAt(cueBall.x + 100, cueBall.y);
                return aimAngle;
            });
            expect(Math.cos(a)).toBeCloseTo(1, 3);
        });

        test('ArrowLeft and ArrowRight rotate the aim', async ({ page }) => {
            await page.evaluate(() => { startGame(); setAim(0); });
            await page.keyboard.press('ArrowRight');
            const right = await page.evaluate(() => aimAngle);
            expect(right).toBeGreaterThan(0);
            await page.keyboard.press('ArrowLeft');
            await page.keyboard.press('ArrowLeft');
            const left = await page.evaluate(() => aimAngle);
            expect(left).toBeLessThan(right);
        });

        test('power starts at zero and charges while held', async ({ page }) => {
            const p = await page.evaluate(() => {
                startGame();
                const start = power;
                beginCharge();
                for (let i = 0; i < 20; i++) step(0.016);
                return { start, charged: power };
            });
            expect(p.start).toBe(0);
            expect(p.charged).toBeGreaterThan(0);
        });

        test('power never charges past the maximum', async ({ page }) => {
            const p = await page.evaluate(() => {
                startGame();
                beginCharge();
                for (let i = 0; i < 600; i++) step(0.016);
                return power;
            });
            expect(p).toBeLessThanOrEqual(1);
            expect(p).toBeCloseTo(1, 5);
        });

        test('releasing the charge takes the shot', async ({ page }) => {
            const s = await page.evaluate(() => {
                startGame();
                setAim(0);
                beginCharge();
                for (let i = 0; i < 40; i++) step(0.016);
                releaseCharge();
                return { state, shots, power, speed: Math.hypot(cueBall.vx, cueBall.vy) };
            });
            expect(s.state).toBe('rolling');
            expect(s.shots).toBe(1);
            expect(s.power).toBe(0);
            expect(s.speed).toBeGreaterThan(0);
        });

        test('releasing with no power does not shoot', async ({ page }) => {
            const s = await page.evaluate(() => {
                startGame();
                beginCharge();
                releaseCharge();
                return { state, shots };
            });
            expect(s.state).toBe('ready');
            expect(s.shots).toBe(0);
        });

        test('a shot cannot be taken while the balls are still rolling', async ({ page }) => {
            const s = await page.evaluate(() => {
                startGame();
                shoot(0, 1);
                const second = shoot(Math.PI, 1);
                return { second, shots };
            });
            expect(s.second).toBe(false);
            expect(s.shots).toBe(1);
        });

        test('holding and releasing Space takes a shot', async ({ page }) => {
            await page.evaluate(() => { startGame(); setAim(0); });
            await page.keyboard.down('Space');
            await page.evaluate(() => { for (let i = 0; i < 30; i++) step(0.016); });
            await page.keyboard.up('Space');
            expect(await page.evaluate(() => shots)).toBe(1);
        });
    });

    // -----------------------------------------------------------------------
    // Physics
    // -----------------------------------------------------------------------
    test.describe('physics', () => {
        test('shooting to the right moves the cue ball right', async ({ page }) => {
            const d = await page.evaluate(() => {
                startGame();
                const before = cueBall.x;
                shoot(0, 0.6);
                for (let i = 0; i < 5; i++) step(0.016);
                return cueBall.x - before;
            });
            expect(d).toBeGreaterThan(0);
        });

        test('friction slows a rolling ball down', async ({ page }) => {
            const s = await page.evaluate(() => {
                startGame();
                objectBalls().forEach((b) => { b.pocketed = true; });
                shoot(0, 0.4);
                const fast = Math.hypot(cueBall.vx, cueBall.vy);
                for (let i = 0; i < 20; i++) step(0.016);
                return { fast, slow: Math.hypot(cueBall.vx, cueBall.vy) };
            });
            expect(s.slow).toBeLessThan(s.fast);
        });

        test('the table returns to ready once every ball has stopped', async ({ page }) => {
            const s = await page.evaluate(() => {
                startGame();
                objectBalls().forEach((b) => { b.pocketed = true; });
                shoot(0.3, 1);
                for (let i = 0; i < 2000 && state === 'rolling'; i++) step(0.016);
                return { state, moving: balls.some((b) => b.vx !== 0 || b.vy !== 0) };
            });
            expect(s.state).toBe('ready');
            expect(s.moving).toBe(false);
        });

        test('a ball bounces off a cushion instead of leaving the table', async ({ page }) => {
            const s = await page.evaluate(() => {
                startGame();
                objectBalls().forEach((b) => { b.pocketed = true; });
                cueBall.x = (LEFT + RIGHT) / 2;
                cueBall.y = (TOP + BOTTOM) / 2;
                shoot(0, 1);
                let bounced = false;
                for (let i = 0; i < 200; i++) {
                    step(0.016);
                    if (cueBall.vx < 0) bounced = true;
                }
                return { bounced, x: cueBall.x };
            });
            expect(s.bounced).toBe(true);
            expect(s.x).toBeLessThan(720);
        });

        test('a cushion bounce loses some speed', async ({ page }) => {
            const s = await page.evaluate(() => {
                startGame();
                objectBalls().forEach((b) => { b.pocketed = true; });
                cueBall.x = RIGHT - BALL_R - 2;
                cueBall.y = (TOP + BOTTOM) / 2;
                cueBall.vx = 300;
                cueBall.vy = 0;
                state = 'rolling';
                const before = Math.abs(cueBall.vx);
                step(0.02);
                return { before, after: Math.abs(cueBall.vx) };
            });
            expect(s.after).toBeLessThan(s.before);
            expect(s.after).toBeGreaterThan(0);
        });

        test('balls never escape the table during a full shot', async ({ page }) => {
            const ok = await page.evaluate(() => {
                startGame();
                shoot(0.42, 1);
                for (let i = 0; i < 2000 && state === 'rolling'; i++) {
                    step(0.016);
                    for (const b of balls) {
                        if (b.pocketed) continue;
                        if (b.x < LEFT - 1 || b.x > RIGHT + 1) return false;
                        if (b.y < TOP - 1 || b.y > BOTTOM + 1) return false;
                    }
                }
                return true;
            });
            expect(ok).toBe(true);
        });

        test('a struck ball is pushed away by the cue ball', async ({ page }) => {
            const s = await page.evaluate(() => {
                startGame();
                objectBalls().forEach((b) => { b.pocketed = true; });
                const target = objectBalls()[0];
                target.pocketed = false;
                cueBall.x = 200;
                cueBall.y = 200;
                target.x = 320;
                target.y = 200;
                shoot(0, 0.7);
                for (let i = 0; i < 20; i++) step(0.016);
                return { tvx: target.vx, tx: target.x };
            });
            expect(s.tvx).toBeGreaterThan(0);
            expect(s.tx).toBeGreaterThan(320);
        });

        test('a head-on hit transfers most of the cue ball speed', async ({ page }) => {
            const s = await page.evaluate(() => {
                startGame();
                objectBalls().forEach((b) => { b.pocketed = true; });
                const target = objectBalls()[0];
                target.pocketed = false;
                cueBall.x = 200; cueBall.y = 200;
                target.x = 300; target.y = 200;
                shoot(0, 0.5);
                const before = Math.hypot(cueBall.vx, cueBall.vy);
                for (let i = 0; i < 20; i++) step(0.016);
                return { cue: Math.hypot(cueBall.vx, cueBall.vy), target: Math.hypot(target.vx, target.vy), before };
            });
            expect(s.target).toBeGreaterThan(s.cue);
            expect(s.target).toBeLessThanOrEqual(s.before);
        });

        test('a glancing hit sends the object ball off at an angle', async ({ page }) => {
            const vy = await page.evaluate(() => {
                startGame();
                objectBalls().forEach((b) => { b.pocketed = true; });
                const target = objectBalls()[0];
                target.pocketed = false;
                cueBall.x = 200; cueBall.y = 200;
                target.x = 300; target.y = 208;
                shoot(0, 0.7);
                for (let i = 0; i < 20; i++) step(0.016);
                return target.vy;
            });
            expect(vy).toBeGreaterThan(0);
        });

        test('overlapping balls are separated by a collision', async ({ page }) => {
            const d = await page.evaluate(() => {
                startGame();
                objectBalls().forEach((b) => { b.pocketed = true; });
                const target = objectBalls()[0];
                target.pocketed = false;
                cueBall.x = 200; cueBall.y = 200;
                target.x = 210; target.y = 200;
                shoot(0, 0.3);
                for (let i = 0; i < 5; i++) step(0.016);
                return Math.hypot(cueBall.x - target.x, cueBall.y - target.y);
            });
            expect(d).toBeGreaterThanOrEqual(2 * 9 - 0.01);
        });
    });

    // -----------------------------------------------------------------------
    // Pockets
    // -----------------------------------------------------------------------
    test.describe('pockets', () => {
        test('a ball that reaches a pocket is potted', async ({ page }) => {
            const s = await page.evaluate(() => {
                startGame();
                shoot(0, 0.3);
                const target = objectBalls().find((b) => !b.isEight);
                target.x = pockets[0].x;
                target.y = pockets[0].y;
                target.vx = 0; target.vy = 0;
                step(0.016);
                return { pocketed: target.pocketed };
            });
            expect(s.pocketed).toBe(true);
        });

        test('potting a colour scores points and shrinks the rack', async ({ page }) => {
            const s = await page.evaluate(() => {
                startGame();
                const before = ballsLeft();
                shoot(0, 0.3);
                const target = objectBalls().find((b) => !b.isEight);
                pocketBall(target);
                return { before, after: ballsLeft(), score };
            });
            expect(s.after).toBe(s.before - 1);
            expect(s.score).toBe(100);
        });

        test('the balls-left readout tracks the rack', async ({ page }) => {
            await page.evaluate(() => {
                startGame();
                shoot(0, 0.3);
                pocketBall(objectBalls().find((b) => !b.isEight));
                balls.forEach((b) => { b.vx = 0; b.vy = 0; });
                step(0.016);
            });
            await expect(page.locator('#left')).toHaveText('9');
        });

        test('potting the cue ball is a foul that costs points', async ({ page }) => {
            const s = await page.evaluate(() => {
                startGame();
                shoot(0, 0.3);
                pocketBall(objectBalls().find((b) => !b.isEight)); // +100
                pocketBall(cueBall);
                balls.forEach((b) => { b.vx = 0; b.vy = 0; });
                step(0.016);
                return { fouls, score, pocketed: cueBall.pocketed, state };
            });
            expect(s.fouls).toBe(1);
            expect(s.score).toBe(50);
            expect(s.pocketed).toBe(false);
            expect(s.state).toBe('ready');
        });

        test('the score never drops below zero from fouls', async ({ page }) => {
            const s = await page.evaluate(() => {
                startGame();
                shoot(0, 0.3);
                pocketBall(cueBall);
                balls.forEach((b) => { b.vx = 0; b.vy = 0; });
                step(0.016);
                return score;
            });
            expect(s).toBe(0);
        });

        test('a respotted cue ball lands clear of the other balls', async ({ page }) => {
            const ok = await page.evaluate(() => {
                startGame();
                shoot(0, 0.3);
                pocketBall(cueBall);
                balls.forEach((b) => { b.vx = 0; b.vy = 0; });
                step(0.016);
                const inside = cueBall.x >= LEFT + BALL_R && cueBall.x <= RIGHT - BALL_R &&
                    cueBall.y >= TOP + BALL_R && cueBall.y <= BOTTOM - BALL_R;
                const clear = objectBalls().every((b) =>
                    b.pocketed || Math.hypot(b.x - cueBall.x, b.y - cueBall.y) >= 2 * BALL_R);
                return inside && clear;
            });
            expect(ok).toBe(true);
        });

        test('a potted ball stops taking part in the game', async ({ page }) => {
            const s = await page.evaluate(() => {
                startGame();
                shoot(0, 0.3);
                const target = objectBalls().find((b) => !b.isEight);
                pocketBall(target);
                const x = target.x;
                for (let i = 0; i < 30; i++) step(0.016);
                return { x, after: target.x, vx: target.vx };
            });
            expect(s.after).toBe(s.x);
            expect(s.vx).toBe(0);
        });
    });

    // -----------------------------------------------------------------------
    // The 8 ball, racks and game over
    // -----------------------------------------------------------------------
    test.describe('the 8 ball', () => {
        test('potting the 8 early loses the game', async ({ page }) => {
            const s = await page.evaluate(() => {
                startGame();
                shoot(0, 0.3);
                pocketBall(objectBalls().find((b) => b.isEight));
                balls.forEach((b) => { b.vx = 0; b.vy = 0; });
                step(0.016);
                return { state, won };
            });
            expect(s.state).toBe('over');
            expect(s.won).toBe(false);
        });

        test('the overlay explains an early 8 ball', async ({ page }) => {
            await page.evaluate(() => {
                startGame();
                shoot(0, 0.3);
                pocketBall(objectBalls().find((b) => b.isEight));
                balls.forEach((b) => { b.vx = 0; b.vy = 0; });
                step(0.016);
            });
            await expect(page.locator('#overlay')).toHaveClass(/visible/);
            await expect(page.locator('#overlay-title')).toContainText(/8/);
            await expect(page.locator('#btn-start')).toHaveText('Play Again');
        });

        test('clearing the colours then the 8 racks up again', async ({ page }) => {
            const s = await page.evaluate(() => {
                startGame();
                shoot(0, 0.3);
                objectBalls().filter((b) => !b.isEight).forEach(pocketBall);
                pocketBall(objectBalls().find((b) => b.isEight));
                balls.forEach((b) => { b.vx = 0; b.vy = 0; });
                step(0.016);
                return { racks, state, left: ballsLeft(), total: balls.length };
            });
            expect(s.racks).toBe(2);
            expect(s.state).toBe('ready');
            expect(s.left).toBe(10);
            expect(s.total).toBe(11);
        });

        test('clearing a rack pays a bonus on top of the potted balls', async ({ page }) => {
            const s = await page.evaluate(() => {
                startGame();
                shoot(0, 0.3);
                objectBalls().filter((b) => !b.isEight).forEach(pocketBall);
                pocketBall(objectBalls().find((b) => b.isEight));
                balls.forEach((b) => { b.vx = 0; b.vy = 0; });
                step(0.016);
                return score;
            });
            expect(s).toBeGreaterThan(9 * 100);
        });

        test('a new rack respots the cue ball on the table', async ({ page }) => {
            const ok = await page.evaluate(() => {
                startGame();
                shoot(0, 0.3);
                objectBalls().forEach(pocketBall);
                balls.forEach((b) => { b.vx = 0; b.vy = 0; });
                step(0.016);
                return !cueBall.pocketed && cueBall.x > LEFT && cueBall.x < RIGHT;
            });
            expect(ok).toBe(true);
        });

        test('scratching on the winning 8 ball still clears the rack', async ({ page }) => {
            const s = await page.evaluate(() => {
                startGame();
                shoot(0, 0.3);
                objectBalls().filter((b) => !b.isEight).forEach(pocketBall);
                pocketBall(objectBalls().find((b) => b.isEight));
                pocketBall(cueBall);
                balls.forEach((b) => { b.vx = 0; b.vy = 0; });
                step(0.016);
                return { racks, fouls, cuePocketed: cueBall.pocketed };
            });
            expect(s.racks).toBe(2);
            expect(s.fouls).toBe(1);
            expect(s.cuePocketed).toBe(false);
        });
    });

    // -----------------------------------------------------------------------
    // Scoring, best score and restart
    // -----------------------------------------------------------------------
    test.describe('scoring', () => {
        test('the score readout follows the score', async ({ page }) => {
            await page.evaluate(() => { startGame(); score = 1234; updateHud(); });
            await expect(page.locator('#score')).toHaveText('1234');
        });

        test('best score updates on game over when beaten', async ({ page }) => {
            await page.evaluate(() => { startGame(); score = 640; updateHud(); endGame(false); });
            await expect(page.locator('#best')).toHaveText('640');
        });

        test('best score persists to localStorage', async ({ page }) => {
            await page.evaluate(() => { startGame(); score = 555; updateHud(); endGame(false); });
            const stored = await page.evaluate(() => window.localStorage.getItem('billiards-best'));
            expect(parseInt(stored, 10)).toBe(555);
        });

        test('best score is not lowered by a worse run', async ({ page }) => {
            await page.evaluate(() => window.localStorage.setItem('billiards-best', '9000'));
            await page.reload();
            await page.evaluate(() => { startGame(); score = 20; updateHud(); endGame(false); });
            await expect(page.locator('#best')).toHaveText('9000');
        });

        test('game over shows the final score on the overlay', async ({ page }) => {
            await page.evaluate(() => { startGame(); score = 777; updateHud(); endGame(false); });
            await expect(page.locator('#overlay-score')).toContainText('777');
        });
    });

    test.describe('restart', () => {
        test('restarting resets score, shots and rack', async ({ page }) => {
            const s = await page.evaluate(() => {
                startGame();
                score = 900; shots = 12; racks = 4; fouls = 3;
                endGame(false);
                startGame();
                return { score, shots, racks, fouls, state };
            });
            expect(s.score).toBe(0);
            expect(s.shots).toBe(0);
            expect(s.racks).toBe(1);
            expect(s.fouls).toBe(0);
            expect(s.state).toBe('ready');
        });

        test('R starts a fresh game mid-rack', async ({ page }) => {
            await page.evaluate(() => { startGame(); score = 500; shots = 7; updateHud(); });
            await page.keyboard.press('KeyR');
            const s = await page.evaluate(() => ({ score, shots, state }));
            expect(s.score).toBe(0);
            expect(s.shots).toBe(0);
            expect(s.state).toBe('ready');
        });

        test('the Play Again button restarts after a loss', async ({ page }) => {
            await page.evaluate(() => { startGame(); endGame(false); });
            await page.locator('#btn-start').click();
            expect(await page.evaluate(() => state)).toBe('ready');
            await expect(page.locator('#overlay')).not.toHaveClass(/visible/);
        });
    });

    // -----------------------------------------------------------------------
    // Mouse control
    // -----------------------------------------------------------------------
    test.describe('mouse control', () => {
        test('moving the mouse over the table aims the cue', async ({ page }) => {
            await page.evaluate(() => { startGame(); setAim(0); cueBall.x = 200; cueBall.y = 200; });
            const box = await page.locator('#canvas').boundingBox();
            await page.mouse.move(box.x + 200, box.y + 340);
            const a = await page.evaluate(() => aimAngle);
            expect(a).toBeGreaterThan(0);
        });

        test('pressing and releasing the mouse takes a shot', async ({ page }) => {
            await page.evaluate(() => { startGame(); setAim(0); });
            const box = await page.locator('#canvas').boundingBox();
            await page.mouse.move(box.x + 600, box.y + 200);
            await page.mouse.down();
            await page.evaluate(() => { for (let i = 0; i < 30; i++) step(0.016); });
            await page.mouse.up();
            expect(await page.evaluate(() => shots)).toBe(1);
        });
    });
});
