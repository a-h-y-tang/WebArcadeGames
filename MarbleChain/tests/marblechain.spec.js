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

        test('HUD starts at score 0, level 1, 3 lives, best 0', async ({ page }) => {
            await expect(page.locator('#score')).toHaveText('0');
            await expect(page.locator('#level')).toHaveText('1');
            await expect(page.locator('#lives')).toHaveText('3');
            await expect(page.locator('#best')).toHaveText('0');
        });

        test('canvas is 720x480', async ({ page }) => {
            const canvas = page.locator('#canvas');
            await expect(canvas).toHaveAttribute('width', '720');
            await expect(canvas).toHaveAttribute('height', '480');
        });

        test('state is idle before starting', async ({ page }) => {
            expect(await page.evaluate(() => state)).toBe('idle');
        });

        test('no marbles on the track before starting', async ({ page }) => {
            expect(await page.evaluate(() => balls.length)).toBe(0);
            expect(await page.evaluate(() => shots.length)).toBe(0);
        });

        test('best score loads from localStorage', async ({ page }) => {
            await page.evaluate(() => window.localStorage.setItem('marblechain-best', '4210'));
            await page.reload();
            await expect(page.locator('#best')).toHaveText('4210');
        });
    });

    // -----------------------------------------------------------------------
    // The track
    // -----------------------------------------------------------------------
    test.describe('track', () => {
        test('track has a positive length', async ({ page }) => {
            expect(await page.evaluate(() => PATH_LEN)).toBeGreaterThan(500);
        });

        test('track start and pit both sit inside the canvas', async ({ page }) => {
            const pts = await page.evaluate(() => [pathPoint(0), pathPoint(PATH_LEN)]);
            for (const p of pts) {
                expect(p.x).toBeGreaterThanOrEqual(0);
                expect(p.x).toBeLessThanOrEqual(720);
                expect(p.y).toBeGreaterThanOrEqual(0);
                expect(p.y).toBeLessThanOrEqual(480);
            }
        });

        test('distances before the track start clamp to the entrance', async ({ page }) => {
            const same = await page.evaluate(() => {
                const a = pathPoint(-500);
                const b = pathPoint(0);
                return a.x === b.x && a.y === b.y;
            });
            expect(same).toBe(true);
        });

        test('track is sampled at even arc length', async ({ page }) => {
            const gaps = await page.evaluate(() => {
                const out = [];
                for (let d = 0; d + 10 < PATH_LEN; d += 100) {
                    const a = pathPoint(d);
                    const b = pathPoint(d + 10);
                    out.push(Math.hypot(b.x - a.x, b.y - a.y));
                }
                return out;
            });
            for (const g of gaps) {
                expect(g).toBeGreaterThan(6);
                expect(g).toBeLessThan(11);
            }
        });

        test('the pit is deeper along the track than the entrance', async ({ page }) => {
            const ok = await page.evaluate(() => nearestDist(pathPoint(400).x, pathPoint(400).y) > 200);
            expect(ok).toBe(true);
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

        test('a new game resets score, level and lives', async ({ page }) => {
            const s = await page.evaluate(() => {
                startGame();
                return { score, level, lives };
            });
            expect(s).toEqual({ score: 0, level: 1, lives: 3 });
        });

        test('starting spawns a chain of marbles', async ({ page }) => {
            const n = await page.evaluate(() => { startGame(); return balls.length; });
            expect(n).toBeGreaterThan(10);
        });

        test('chain marbles are ordered front-first and evenly spaced', async ({ page }) => {
            const ok = await page.evaluate(() => {
                startGame();
                for (let i = 1; i < balls.length; i++) {
                    const gap = balls[i - 1].dist - balls[i].dist;
                    if (Math.abs(gap - SPACING) > 0.001) return false;
                }
                return true;
            });
            expect(ok).toBe(true);
        });

        test('the chain enters from before the track start', async ({ page }) => {
            const back = await page.evaluate(() => { startGame(); return balls[balls.length - 1].dist; });
            expect(back).toBeLessThan(0);
        });

        test('every marble uses a valid colour for the level', async ({ page }) => {
            const ok = await page.evaluate(() => {
                startGame();
                return balls.every((b) => Number.isInteger(b.color) && b.color >= 0 && b.color < colorCount(level));
            });
            expect(ok).toBe(true);
        });

        test('the launcher is loaded with a current and next marble', async ({ page }) => {
            const l = await page.evaluate(() => { startGame(); return { c: launcher.color, n: launcher.next }; });
            expect(l.c).toBeGreaterThanOrEqual(0);
            expect(l.c).toBeLessThan(5);
            expect(l.n).toBeGreaterThanOrEqual(0);
            expect(l.n).toBeLessThan(5);
        });

        test('later levels use more colours and a faster chain', async ({ page }) => {
            const r = await page.evaluate(() => ({
                c1: colorCount(1),
                c5: colorCount(5),
                s1: chainSpeedFor(1),
                s3: chainSpeedFor(3),
            }));
            expect(r.c5).toBeGreaterThan(r.c1);
            expect(r.s3).toBeGreaterThan(r.s1);
        });
    });

    // -----------------------------------------------------------------------
    // Aiming
    // -----------------------------------------------------------------------
    test.describe('aiming', () => {
        test('moving the mouse aims the launcher at the pointer', async ({ page }) => {
            const box = await page.locator('#canvas').boundingBox();
            await page.evaluate(() => startGame());
            const ly = await page.evaluate(() => launcherY());
            await page.mouse.move(box.x + 700, box.y + ly);
            const angle = await page.evaluate(() => launcher.angle);
            expect(Math.abs(Math.atan2(Math.sin(angle), Math.cos(angle)))).toBeLessThan(0.25);
        });

        test('ArrowLeft rotates the launcher anticlockwise', async ({ page }) => {
            const r = await page.evaluate(async () => {
                startGame();
                launcher.angle = 0;
                return { before: launcher.angle };
            });
            await page.keyboard.press('ArrowLeft');
            const after = await page.evaluate(() => launcher.angle);
            expect(after).toBeLessThan(r.before);
        });

        test('ArrowRight rotates the launcher clockwise', async ({ page }) => {
            await page.evaluate(() => { startGame(); launcher.angle = 0; });
            await page.keyboard.press('ArrowRight');
            expect(await page.evaluate(() => launcher.angle)).toBeGreaterThan(0);
        });
    });

    // -----------------------------------------------------------------------
    // Shooting
    // -----------------------------------------------------------------------
    test.describe('shooting', () => {
        test('shooting launches a marble along the aim direction', async ({ page }) => {
            const s = await page.evaluate(() => {
                startGame();
                launcher.angle = 0;
                shoot();
                return shots.length ? { vx: shots[0].vx, vy: shots[0].vy } : null;
            });
            expect(s).not.toBeNull();
            expect(s.vx).toBeGreaterThan(0);
            expect(Math.abs(s.vy)).toBeLessThan(1);
        });

        test('the fired marble carries the launcher colour', async ({ page }) => {
            const r = await page.evaluate(() => {
                startGame();
                const c = launcher.color;
                shoot();
                return { c, shot: shots[0].color };
            });
            expect(r.shot).toBe(r.c);
        });

        test('firing promotes the next marble into the launcher', async ({ page }) => {
            const r = await page.evaluate(() => {
                startGame();
                const next = launcher.next;
                shoot();
                return { next, color: launcher.color };
            });
            expect(r.color).toBe(r.next);
        });

        test('a cooldown prevents firing twice in the same instant', async ({ page }) => {
            const n = await page.evaluate(() => {
                startGame();
                shoot();
                shoot();
                return shots.length;
            });
            expect(n).toBe(1);
        });

        test('the cooldown expires after stepping the simulation', async ({ page }) => {
            const n = await page.evaluate(() => {
                startGame();
                shoot();
                step(SHOOT_COOLDOWN + 0.01);
                shoot();
                return shots.length;
            });
            expect(n).toBe(2);
        });

        test('shooting does nothing before the game starts', async ({ page }) => {
            const n = await page.evaluate(() => { shoot(); return shots.length; });
            expect(n).toBe(0);
        });

        test('Space fires while the game is running', async ({ page }) => {
            await page.evaluate(() => startGame());
            await page.keyboard.press('Space');
            expect(await page.evaluate(() => shots.length)).toBe(1);
        });

        test('clicking the canvas fires', async ({ page }) => {
            await page.evaluate(() => startGame());
            await page.locator('#canvas').click({ position: { x: 700, y: 240 } });
            expect(await page.evaluate(() => shots.length)).toBeGreaterThanOrEqual(1);
        });

        test('a fired marble travels away from the launcher', async ({ page }) => {
            const moved = await page.evaluate(() => {
                startGame();
                balls.length = 0;
                launcher.angle = 0;
                shoot();
                const x0 = shots[0].x;
                step(0.05);
                return shots[0].x - x0;
            });
            expect(moved).toBeGreaterThan(5);
        });

        test('a marble that leaves the canvas is discarded', async ({ page }) => {
            const n = await page.evaluate(() => {
                startGame();
                balls.length = 0;
                launcher.angle = 0;
                shoot();
                for (let i = 0; i < 60; i++) step(0.05);
                return shots.length;
            });
            expect(n).toBe(0);
        });
    });

    // -----------------------------------------------------------------------
    // Swapping
    // -----------------------------------------------------------------------
    test.describe('swapping', () => {
        test('X swaps the current and next marbles', async ({ page }) => {
            const before = await page.evaluate(() => {
                startGame();
                launcher.color = 0;
                launcher.next = 3;
                return { c: launcher.color, n: launcher.next };
            });
            await page.keyboard.press('x');
            const after = await page.evaluate(() => ({ c: launcher.color, n: launcher.next }));
            expect(after.c).toBe(before.n);
            expect(after.n).toBe(before.c);
        });

        test('swapping does nothing before the game starts', async ({ page }) => {
            const r = await page.evaluate(() => {
                launcher.color = 1;
                launcher.next = 2;
                swapNext();
                return { c: launcher.color, n: launcher.next };
            });
            expect(r).toEqual({ c: 1, n: 2 });
        });
    });

    // -----------------------------------------------------------------------
    // Chain movement
    // -----------------------------------------------------------------------
    test.describe('chain movement', () => {
        test('the chain crawls towards the pit', async ({ page }) => {
            const moved = await page.evaluate(() => {
                startGame();
                const before = balls[0].dist;
                step(1);
                return balls[0].dist - before;
            });
            expect(moved).toBeGreaterThan(0);
        });

        test('marbles never overlap while advancing', async ({ page }) => {
            const ok = await page.evaluate(() => {
                startGame();
                for (let i = 0; i < 120; i++) step(1 / 60);
                for (let i = 1; i < balls.length; i++) {
                    if (balls[i - 1].dist - balls[i].dist < SPACING - 0.001) return false;
                }
                return true;
            });
            expect(ok).toBe(true);
        });

        test('a gap in the chain closes up as the back catches up', async ({ page }) => {
            const r = await page.evaluate(() => {
                startGame();
                setChain([0, 1, 2], 100);
                balls[2].dist -= 120;
                const before = balls[1].dist - balls[2].dist;
                for (let i = 0; i < 120; i++) step(1 / 60);
                return { before, after: balls[1].dist - balls[2].dist };
            });
            expect(r.after).toBeLessThan(r.before);
            expect(r.after).toBeGreaterThanOrEqual(24 - 0.001);
        });

        test('the animation loop advances the chain on its own', async ({ page }) => {
            await page.evaluate(() => startGame());
            const before = await page.evaluate(() => balls[0].dist);
            await page.waitForTimeout(400);
            const after = await page.evaluate(() => balls[0].dist);
            expect(after).toBeGreaterThan(before);
        });
    });

    // -----------------------------------------------------------------------
    // Landing marbles and matching
    // -----------------------------------------------------------------------
    test.describe('matching', () => {
        test('a landed marble with no match joins the chain', async ({ page }) => {
            const r = await page.evaluate(() => {
                startGame();
                setChain([0, 1, 2, 3], 200);
                landShot(200 - SPACING * 1.5, 4);
                return { n: balls.length, colors: balls.map((b) => b.color) };
            });
            expect(r.n).toBe(5);
            expect(r.colors).toContain(4);
        });

        test('the chain stays evenly spaced after an insertion', async ({ page }) => {
            const ok = await page.evaluate(() => {
                startGame();
                setChain([0, 1, 2, 3], 200);
                landShot(200 - SPACING * 1.5, 4);
                for (let i = 1; i < balls.length; i++) {
                    if (balls[i - 1].dist - balls[i].dist < SPACING - 0.001) return false;
                }
                return true;
            });
            expect(ok).toBe(true);
        });

        test('completing three of a colour clears them', async ({ page }) => {
            const n = await page.evaluate(() => {
                startGame();
                setChain([1, 1, 2, 3], 200);
                landShot(200 - SPACING * 1.5, 1);
                return balls.length;
            });
            expect(n).toBe(2);
        });

        test('clearing three marbles scores 30 points', async ({ page }) => {
            const s = await page.evaluate(() => {
                startGame();
                score = 0;
                setChain([1, 1, 2, 3], 200);
                landShot(200 - SPACING * 1.5, 1);
                return score;
            });
            expect(s).toBe(30);
        });

        test('a longer run clears every matching marble', async ({ page }) => {
            const r = await page.evaluate(() => {
                startGame();
                score = 0;
                setChain([2, 2, 2, 2, 0], 200);
                landShot(200 - SPACING * 2.5, 2);
                return { n: balls.length, score };
            });
            expect(r.n).toBe(1);
            expect(r.score).toBe(50);
        });

        test('two of a colour are not enough to clear', async ({ page }) => {
            const n = await page.evaluate(() => {
                startGame();
                setChain([1, 2, 3, 4], 200);
                landShot(200 - SPACING * 0.5, 1);
                return balls.length;
            });
            expect(n).toBe(5);
        });

        test('a collapse that joins matching colours chain-reacts for bonus points', async ({ page }) => {
            const r = await page.evaluate(() => {
                startGame();
                score = 0;
                setChain([0, 0, 2, 2, 0, 0], 300);
                landShot(300 - SPACING * 1.5, 2);
                return { n: balls.length, score };
            });
            expect(r.n).toBe(0);
            expect(r.score).toBe(110);
        });

        test('the HUD shows the score after a clear', async ({ page }) => {
            await page.evaluate(() => {
                startGame();
                score = 0;
                setChain([1, 1, 2, 3], 200);
                landShot(200 - SPACING * 1.5, 1);
            });
            await expect(page.locator('#score')).toHaveText('30');
        });

        test('a flying marble that reaches the chain lands in it', async ({ page }) => {
            const r = await page.evaluate(() => {
                startGame();
                setChain([0, 1, 2, 3, 4], PATH_LEN * 0.5);
                const target = pathPoint(balls[2].dist);
                launcher.angle = Math.atan2(target.y - launcher.y, target.x - launcher.x);
                shoot();
                const before = balls.length;
                for (let i = 0; i < 120 && shots.length; i++) step(1 / 120);
                return { before, after: balls.length, flying: shots.length };
            });
            expect(r.flying).toBe(0);
            expect(r.after).toBeGreaterThanOrEqual(r.before);
        });
    });

    // -----------------------------------------------------------------------
    // Losing
    // -----------------------------------------------------------------------
    test.describe('losing a life', () => {
        test('a marble reaching the pit costs a life', async ({ page }) => {
            const r = await page.evaluate(() => {
                startGame();
                setChain([0, 1, 2], PATH_LEN - 1);
                step(1);
                return { lives, n: balls.length };
            });
            expect(r.lives).toBe(2);
            expect(r.n).toBeGreaterThan(3);
        });

        test('losing a life respawns the chain for the same level', async ({ page }) => {
            const r = await page.evaluate(() => {
                startGame();
                const lvl = level;
                setChain([0, 1, 2], PATH_LEN - 1);
                step(1);
                return { lvl, level, state };
            });
            expect(r.level).toBe(r.lvl);
            expect(r.state).toBe('running');
        });

        test('losing the last life ends the game', async ({ page }) => {
            const r = await page.evaluate(() => {
                startGame();
                lives = 1;
                setChain([0, 1, 2], PATH_LEN - 1);
                step(1);
                return { lives, state };
            });
            expect(r.lives).toBe(0);
            expect(r.state).toBe('gameover');
        });

        test('game over shows the overlay', async ({ page }) => {
            await page.evaluate(() => {
                startGame();
                lives = 1;
                setChain([0, 1, 2], PATH_LEN - 1);
                step(1);
            });
            await expect(page.locator('#overlay')).toHaveClass(/visible/);
            await expect(page.locator('#overlay-title')).toContainText(/over/i);
        });

        test('game over records a new best score', async ({ page }) => {
            const best = await page.evaluate(() => {
                startGame();
                score = 777;
                lives = 1;
                setChain([0, 1, 2], PATH_LEN - 1);
                step(1);
                return window.localStorage.getItem('marblechain-best');
            });
            expect(best).toBe('777');
            await expect(page.locator('#best')).toHaveText('777');
        });

        test('a game over can be restarted with Space', async ({ page }) => {
            await page.evaluate(() => {
                startGame();
                lives = 1;
                setChain([0, 1, 2], PATH_LEN - 1);
                step(1);
            });
            await page.keyboard.press('Space');
            expect(await page.evaluate(() => state)).toBe('running');
            expect(await page.evaluate(() => lives)).toBe(3);
        });
    });

    // -----------------------------------------------------------------------
    // Clearing a level
    // -----------------------------------------------------------------------
    test.describe('level clear', () => {
        test('emptying the track clears the level', async ({ page }) => {
            const s = await page.evaluate(() => {
                startGame();
                balls.length = 0;
                step(1 / 60);
                return state;
            });
            expect(s).toBe('levelclear');
        });

        test('clearing a level awards a bonus', async ({ page }) => {
            const s = await page.evaluate(() => {
                startGame();
                score = 0;
                balls.length = 0;
                step(1 / 60);
                return score;
            });
            expect(s).toBeGreaterThan(0);
        });

        test('Space advances to the next level with a fresh chain', async ({ page }) => {
            await page.evaluate(() => {
                startGame();
                balls.length = 0;
                step(1 / 60);
            });
            await page.keyboard.press('Space');
            const r = await page.evaluate(() => ({ level, state, n: balls.length }));
            expect(r.level).toBe(2);
            expect(r.state).toBe('running');
            expect(r.n).toBeGreaterThan(10);
            await expect(page.locator('#level')).toHaveText('2');
        });
    });

    // -----------------------------------------------------------------------
    // Pausing
    // -----------------------------------------------------------------------
    test.describe('pausing', () => {
        test('P pauses and resumes', async ({ page }) => {
            await page.evaluate(() => startGame());
            await page.keyboard.press('p');
            expect(await page.evaluate(() => state)).toBe('paused');
            await page.keyboard.press('p');
            expect(await page.evaluate(() => state)).toBe('running');
        });

        test('the chain is frozen while paused', async ({ page }) => {
            await page.evaluate(() => startGame());
            await page.keyboard.press('p');
            const before = await page.evaluate(() => balls[0].dist);
            await page.waitForTimeout(250);
            const after = await page.evaluate(() => balls[0].dist);
            expect(after).toBe(before);
        });

        test('a paused game shows the overlay', async ({ page }) => {
            await page.evaluate(() => startGame());
            await page.keyboard.press('p');
            await expect(page.locator('#overlay')).toHaveClass(/visible/);
            await expect(page.locator('#overlay-title')).toContainText(/paused/i);
        });

        test('shooting is ignored while paused', async ({ page }) => {
            await page.evaluate(() => startGame());
            await page.keyboard.press('p');
            await page.keyboard.press('Space');
            expect(await page.evaluate(() => shots.length)).toBe(0);
        });
    });

    // -----------------------------------------------------------------------
    // Rendering
    // -----------------------------------------------------------------------
    test.describe('rendering', () => {
        test('the canvas is not blank once the game is running', async ({ page }) => {
            await page.evaluate(() => startGame());
            await page.waitForTimeout(200);
            const painted = await page.evaluate(() => {
                const data = canvas.getContext('2d').getImageData(0, 0, 720, 480).data;
                const first = [data[0], data[1], data[2]];
                for (let i = 4; i < data.length; i += 4) {
                    if (data[i] !== first[0] || data[i + 1] !== first[1] || data[i + 2] !== first[2]) return true;
                }
                return false;
            });
            expect(painted).toBe(true);
        });

        test('the help text documents the controls', async ({ page }) => {
            const help = page.locator('.help');
            await expect(help).toContainText(/aim/i);
            await expect(help).toContainText(/swap/i);
        });
    });
});
