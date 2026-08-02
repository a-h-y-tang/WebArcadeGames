const { test, expect } = require('@playwright/test');
const path = require('path');
const { pathToFileURL } = require('url');

const GAME_URL = pathToFileURL(path.resolve(__dirname, '../index.html')).href;

test.describe('Zuma', () => {
    test.beforeEach(async ({ page }) => {
        await page.goto(GAME_URL);
    });

    // -----------------------------------------------------------------------
    // Initial / idle state
    // -----------------------------------------------------------------------
    test.describe('initial state', () => {
        test('page title is Zuma', async ({ page }) => {
            await expect(page).toHaveTitle('Zuma');
        });

        test('start overlay is visible', async ({ page }) => {
            await expect(page.locator('#overlay')).toHaveClass(/visible/);
        });

        test('overlay prompts the player to start', async ({ page }) => {
            await expect(page.locator('#overlay-sub')).toContainText(/space|start/i);
        });

        test('score, level and best are shown at their starting values', async ({ page }) => {
            await expect(page.locator('#score')).toHaveText('0');
            await expect(page.locator('#level')).toHaveText('1');
            await expect(page.locator('#best')).toHaveText('0');
        });

        test('canvas is 640x480', async ({ page }) => {
            const canvas = page.locator('#canvas');
            await expect(canvas).toHaveAttribute('width', '640');
            await expect(canvas).toHaveAttribute('height', '480');
        });

        test('state is idle before starting', async ({ page }) => {
            expect(await page.evaluate(() => state)).toBe('idle');
        });

        test('no marbles on the track before starting', async ({ page }) => {
            expect(await page.evaluate(() => marbles.length)).toBe(0);
        });

        test('best score loads from localStorage', async ({ page }) => {
            await page.evaluate(() => window.localStorage.setItem('zuma-best', '4210'));
            await page.reload();
            await expect(page.locator('#best')).toHaveText('4210');
        });
    });

    // -----------------------------------------------------------------------
    // The track
    // -----------------------------------------------------------------------
    test.describe('track geometry', () => {
        test('path has a positive length', async ({ page }) => {
            expect(await page.evaluate(() => PATH_LENGTH)).toBeGreaterThan(1000);
        });

        test('pathPoint stays inside the canvas for on-track distances', async ({ page }) => {
            const ok = await page.evaluate(() => {
                for (let d = 100; d <= PATH_LENGTH; d += 10) {
                    const p = pathPoint(d);
                    if (p.x < -1 || p.x > CANVAS_W + 1 || p.y < -1 || p.y > CANVAS_H + 1) {
                        return `${d}: ${p.x},${p.y}`;
                    }
                }
                return 'ok';
            });
            expect(ok).toBe('ok');
        });

        test('pathPoint advances monotonically in arc length', async ({ page }) => {
            const gaps = await page.evaluate(() => {
                const out = [];
                for (let d = 0; d + 20 <= PATH_LENGTH; d += 20) {
                    const a = pathPoint(d);
                    const b = pathPoint(d + 20);
                    out.push(Math.hypot(b.x - a.x, b.y - a.y));
                }
                return out;
            });
            expect(Math.min(...gaps)).toBeGreaterThan(1);
            expect(Math.max(...gaps)).toBeLessThan(21);
        });

        test('negative distances sit off the left edge of the canvas', async ({ page }) => {
            const p = await page.evaluate(() => pathPoint(-50));
            expect(p.x).toBeLessThan(0);
        });

        test('pathAngle returns a direction that matches the path', async ({ page }) => {
            const ok = await page.evaluate(() => {
                const d = PATH_LENGTH / 2;
                const a = pathAngle(d);
                const p0 = pathPoint(d);
                const p1 = pathPoint(d + 5);
                const dot = Math.cos(a) * (p1.x - p0.x) + Math.sin(a) * (p1.y - p0.y);
                return dot > 0;
            });
            expect(ok).toBe(true);
        });
    });

    // -----------------------------------------------------------------------
    // Starting
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

        test('a fresh game starts on level 1 with score 0 and a full queue', async ({ page }) => {
            const s = await page.evaluate(() => {
                startGame();
                return { level, score, queued: spawnQueue.length };
            });
            expect(s.level).toBe(1);
            expect(s.score).toBe(0);
            expect(s.queued).toBeGreaterThan(20);
        });

        test('the launcher is loaded with a current and a next marble', async ({ page }) => {
            const s = await page.evaluate(() => {
                startGame();
                return { current: launcher.current, next: launcher.next };
            });
            expect(typeof s.current).toBe('string');
            expect(typeof s.next).toBe('string');
        });

        test('marbles feed onto the track as time passes', async ({ page }) => {
            const count = await page.evaluate(() => {
                setSeed(7);
                startGame();
                for (let i = 0; i < 200; i++) update(0.05);
                return marbles.length;
            });
            expect(count).toBeGreaterThan(3);
        });

        test('the chain never exceeds the spacing between neighbours', async ({ page }) => {
            const worst = await page.evaluate(() => {
                setSeed(3);
                startGame();
                for (let i = 0; i < 400; i++) update(0.05);
                let min = Infinity;
                for (let i = 1; i < marbles.length; i++) {
                    min = Math.min(min, marbles[i - 1].dist - marbles[i].dist);
                }
                return min;
            });
            expect(worst).toBeGreaterThan(0);
        });

        test('marbles move toward the hole over time', async ({ page }) => {
            const moved = await page.evaluate(() => {
                setSeed(11);
                startGame();
                for (let i = 0; i < 40; i++) update(0.05);
                const before = marbles[0].dist;
                for (let i = 0; i < 40; i++) update(0.05);
                return marbles[0].dist - before;
            });
            expect(moved).toBeGreaterThan(0);
        });
    });

    // -----------------------------------------------------------------------
    // Aiming and firing
    // -----------------------------------------------------------------------
    test.describe('launcher', () => {
        test('moving the mouse aims the launcher', async ({ page }) => {
            await page.evaluate(() => startGame());
            const box = await page.locator('#canvas').boundingBox();
            await page.mouse.move(box.x + 20, box.y + 20);
            const a1 = await page.evaluate(() => launcher.angle);
            await page.mouse.move(box.x + box.width - 20, box.y + 20);
            const a2 = await page.evaluate(() => launcher.angle);
            expect(a1).not.toBeCloseTo(a2, 2);
        });

        test('arrow keys rotate the aim', async ({ page }) => {
            await page.evaluate(() => startGame());
            const before = await page.evaluate(() => launcher.angle);
            await page.keyboard.press('ArrowRight');
            const after = await page.evaluate(() => launcher.angle);
            expect(after).toBeGreaterThan(before);

            await page.keyboard.press('ArrowLeft');
            await page.keyboard.press('ArrowLeft');
            const back = await page.evaluate(() => launcher.angle);
            expect(back).toBeLessThan(after);
        });

        test('the aim cannot point straight down into the launcher', async ({ page }) => {
            const clamped = await page.evaluate(() => {
                startGame();
                for (let i = 0; i < 200; i++) rotateAim(1);
                const hi = launcher.angle;
                for (let i = 0; i < 400; i++) rotateAim(-1);
                return { hi, lo: launcher.angle };
            });
            expect(clamped.hi).toBeLessThan(0);
            expect(clamped.lo).toBeGreaterThan(-Math.PI);
        });

        test('Space fires a projectile', async ({ page }) => {
            await page.evaluate(() => startGame());
            await page.keyboard.press('Space');
            expect(await page.evaluate(() => projectiles.length)).toBe(1);
        });

        test('clicking the canvas fires a projectile', async ({ page }) => {
            await page.evaluate(() => startGame());
            await page.locator('#canvas').click({ position: { x: 320, y: 60 } });
            expect(await page.evaluate(() => projectiles.length)).toBe(1);
        });

        test('firing promotes the next marble to current', async ({ page }) => {
            const s = await page.evaluate(() => {
                setSeed(5);
                startGame();
                const next = launcher.next;
                shoot();
                return { next, current: launcher.current };
            });
            expect(s.current).toBe(s.next);
        });

        test('only one projectile is in flight at a time', async ({ page }) => {
            const n = await page.evaluate(() => {
                startGame();
                shoot();
                shoot();
                shoot();
                return projectiles.length;
            });
            expect(n).toBe(1);
        });

        test('the projectile travels along the aim angle', async ({ page }) => {
            const ok = await page.evaluate(() => {
                startGame();
                launcher.angle = -Math.PI / 2;
                shoot();
                const y0 = projectiles[0].y;
                update(0.05);
                return projectiles.length > 0 && projectiles[0].y < y0;
            });
            expect(ok).toBe(true);
        });

        test('a projectile that misses everything leaves the field', async ({ page }) => {
            const n = await page.evaluate(() => {
                startGame();
                marbles.length = 0;
                spawnQueue.length = 0;
                launcher.angle = -Math.PI / 2;
                shoot();
                for (let i = 0; i < 60; i++) update(0.05);
                return projectiles.length;
            });
            expect(n).toBe(0);
        });

        test('S swaps the current and next marbles', async ({ page }) => {
            await page.evaluate(() => { setSeed(9); startGame(); launcher.current = 'red'; launcher.next = 'blue'; });
            await page.keyboard.press('s');
            const s = await page.evaluate(() => ({ current: launcher.current, next: launcher.next }));
            expect(s.current).toBe('blue');
            expect(s.next).toBe('red');
        });

        test('right-clicking the canvas swaps the marbles', async ({ page }) => {
            await page.evaluate(() => { startGame(); launcher.current = 'red'; launcher.next = 'blue'; });
            await page.locator('#canvas').click({ button: 'right', position: { x: 320, y: 100 } });
            const s = await page.evaluate(() => ({ current: launcher.current, next: launcher.next }));
            expect(s.current).toBe('blue');
            expect(s.next).toBe('red');
        });

        test('the launcher only loads colours still on the track', async ({ page }) => {
            const colors = await page.evaluate(() => {
                setSeed(2);
                startGame();
                spawnQueue.length = 0;
                marbles.length = 0;
                for (let i = 0; i < 6; i++) marbles.push({ dist: 400 - i * MARBLE_SPACING, color: 'red' });
                const seen = [];
                for (let i = 0; i < 20; i++) { reload(); seen.push(launcher.current, launcher.next); }
                return [...new Set(seen)];
            });
            expect(colors).toEqual(['red']);
        });
    });

    // -----------------------------------------------------------------------
    // Insertion and matching
    // -----------------------------------------------------------------------
    test.describe('insertion', () => {
        // Lays out `colors` as a tightly packed chain ending at `startDist`.
        // Declared as a string so it can be handed to page.evaluate as an arg.
        const CHAIN = `(colors, startDist) => {
            marbles.length = 0;
            colors.forEach((c, i) => marbles.push({ dist: startDist - i * MARBLE_SPACING, color: c }));
        }`;

        test('a non-matching marble joins the chain', async ({ page }) => {
            const s = await page.evaluate((src) => {
                startGame();
                const chain = new Function('return ' + src)();
                chain(['red', 'blue', 'green'], 400);
                insertMarble(1, 'green');
                return { len: marbles.length, colors: marbles.map((m) => m.color) };
            }, CHAIN);
            expect(s.len).toBe(4);
            expect(s.colors).toEqual(['red', 'green', 'blue', 'green']);
        });

        test('inserting keeps the chain ordered front-to-back', async ({ page }) => {
            const ordered = await page.evaluate((src) => {
                startGame();
                const chain = new Function('return ' + src)();
                chain(['red', 'blue', 'green', 'blue'], 500);
                insertMarble(2, 'red');
                for (let i = 1; i < marbles.length; i++) {
                    if (marbles[i].dist >= marbles[i - 1].dist) return false;
                }
                return true;
            }, CHAIN);
            expect(ordered).toBe(true);
        });

        test('inserting never pushes the front marble forward', async ({ page }) => {
            const s = await page.evaluate((src) => {
                startGame();
                const chain = new Function('return ' + src)();
                const out = [];
                for (const k of [0, 1, 3]) {
                    chain(['red', 'blue', 'green', 'yellow'], 400);
                    const front = marbles[0].dist;
                    insertMarble(k, 'cyan');
                    out.push(marbles[0].dist - front);
                }
                return out;
            }, CHAIN);
            expect(Math.max(...s)).toBeLessThanOrEqual(0);
        });

        test('a marble ahead of the one it touched lands in front of it', async ({ page }) => {
            const s = await page.evaluate((src) => {
                startGame();
                const chain = new Function('return ' + src)();
                chain(['red', 'blue', 'green'], 500);
                const target = marbles[1];
                const at = pathPoint(target.dist);
                const a = pathAngle(target.dist);
                // A hair further along the track than the marble it touched.
                const ahead = { x: at.x + Math.cos(a) * 6, y: at.y + Math.sin(a) * 6, color: 'cyan' };
                const behind = { x: at.x - Math.cos(a) * 6, y: at.y - Math.sin(a) * 6, color: 'cyan' };
                return { ahead: insertionIndex(ahead, 1), behind: insertionIndex(behind, 1) };
            }, CHAIN);
            expect(s.ahead).toBe(1);
            expect(s.behind).toBe(2);
        });

        test('a shot arriving from behind lands behind the marble it touched', async ({ page }) => {
            const s = await page.evaluate((src) => {
                startGame();
                spawnQueue.length = 0;
                const chain = new Function('return ' + src)();
                chain(['red', 'blue', 'green'], 500);
                // Aim just short of the tail marble so contact happens on its
                // trailing side; the new marble must end up last. Only the
                // projectile is stepped, so the chain can't drift out from
                // under the aim while the shot is in the air.
                const tail = marbles[2];
                const at = pathPoint(tail.dist);
                const a = pathAngle(tail.dist);
                const aimX = at.x - Math.cos(a) * 9;
                const aimY = at.y - Math.sin(a) * 9;
                launcher.current = 'cyan';
                launcher.angle = Math.atan2(aimY - launcher.y, aimX - launcher.x);
                shoot();
                for (let i = 0; i < 200 && projectiles.length; i++) updateProjectiles(0.005);
                return marbles.map((m) => m.color);
            }, CHAIN);
            expect(s).toEqual(['red', 'blue', 'green', 'cyan']);
        });

        test('completing a run of three pops it', async ({ page }) => {
            const s = await page.evaluate((src) => {
                startGame();
                score = 0;
                const chain = new Function('return ' + src)();
                chain(['blue', 'red', 'red', 'blue'], 500);
                insertMarble(1, 'red');
                return { colors: marbles.map((m) => m.color), score };
            }, CHAIN);
            expect(s.colors).toEqual(['blue', 'blue']);
            expect(s.score).toBeGreaterThan(0);
        });

        test('a run of two does not pop', async ({ page }) => {
            const s = await page.evaluate((src) => {
                startGame();
                score = 0;
                const chain = new Function('return ' + src)();
                chain(['blue', 'red', 'green'], 400);
                insertMarble(1, 'red');
                return { len: marbles.length, score };
            }, CHAIN);
            expect(s.len).toBe(4);
            expect(s.score).toBe(0);
        });

        test('popping a run of five scores more than a run of three', async ({ page }) => {
            const s = await page.evaluate((src) => {
                startGame();
                const chain = new Function('return ' + src)();
                score = 0;
                chain(['red', 'red'], 500);
                insertMarble(0, 'red');
                const three = score;
                score = 0;
                chain(['red', 'red', 'red', 'red'], 500);
                insertMarble(0, 'red');
                return { three, five: score };
            }, CHAIN);
            expect(s.five).toBeGreaterThan(s.three);
        });

        test('a chain reaction pops the marbles left on both sides of the gap', async ({ page }) => {
            const s = await page.evaluate((src) => {
                startGame();
                score = 0;
                const chain = new Function('return ' + src)();
                // green green | red red | green  -> inserting red pops the reds,
                // leaving green green green which pops as a combo.
                chain(['green', 'green', 'red', 'red', 'green'], 600);
                insertMarble(2, 'red');
                return { len: marbles.length, score, combo: lastCombo };
            }, CHAIN);
            expect(s.len).toBe(0);
            expect(s.combo).toBeGreaterThan(1);
        });

        test('a combo is worth more than the same marbles popped separately', async ({ page }) => {
            const s = await page.evaluate((src) => {
                startGame();
                const chain = new Function('return ' + src)();
                score = 0;
                chain(['green', 'green', 'red', 'red', 'green'], 600);
                insertMarble(2, 'red');
                const combo = score;
                score = 0;
                chain(['red', 'red'], 600);
                insertMarble(0, 'red');
                chain(['green', 'green'], 600);
                insertMarble(0, 'green');
                return { combo, separate: score };
            }, CHAIN);
            expect(s.combo).toBeGreaterThan(s.separate);
        });

        test('a projectile that reaches the chain is consumed and inserted', async ({ page }) => {
            const s = await page.evaluate(() => {
                setSeed(4);
                startGame();
                spawnQueue.length = 0;
                marbles.length = 0;
                for (let i = 0; i < 5; i++) marbles.push({ dist: 500 - i * MARBLE_SPACING, color: 'blue' });
                const target = pathPoint(500 - 2 * MARBLE_SPACING);
                launcher.current = 'red';
                launcher.angle = Math.atan2(target.y - launcher.y, target.x - launcher.x);
                shoot();
                for (let i = 0; i < 120 && projectiles.length; i++) update(0.01);
                return { projectiles: projectiles.length, len: marbles.length };
            });
            expect(s.projectiles).toBe(0);
            expect(s.len).toBe(6);
        });
    });

    // -----------------------------------------------------------------------
    // Winning and losing
    // -----------------------------------------------------------------------
    test.describe('level flow', () => {
        test('clearing the queue and the track completes the level', async ({ page }) => {
            const s = await page.evaluate(() => {
                startGame();
                score = 0;
                spawnQueue.length = 0;
                marbles.length = 0;
                marbles.push({ dist: 300, color: 'red' }, { dist: 300 - MARBLE_SPACING, color: 'red' });
                insertMarble(0, 'red');
                update(0.016);
                return { level, score, state };
            });
            expect(s.level).toBe(2);
            expect(s.score).toBeGreaterThan(0);
            expect(s.state).toBe('running');
        });

        test('later levels are faster and use more colours', async ({ page }) => {
            const s = await page.evaluate(() => {
                startGame();
                const l1 = { speed: chainSpeed(), colors: levelColors().length };
                level = 4;
                const l4 = { speed: chainSpeed(), colors: levelColors().length };
                return { l1, l4 };
            });
            expect(s.l4.speed).toBeGreaterThan(s.l1.speed);
            expect(s.l4.colors).toBeGreaterThan(s.l1.colors);
        });

        test('reaching the hole ends the game', async ({ page }) => {
            const s = await page.evaluate(() => {
                startGame();
                marbles.length = 0;
                marbles.push({ dist: PATH_LENGTH - 1, color: 'red' });
                for (let i = 0; i < 60; i++) update(0.05);
                return state;
            });
            expect(s).toBe('gameover');
        });

        test('game over shows the overlay with the final score', async ({ page }) => {
            await page.evaluate(() => {
                startGame();
                score = 1234;
                marbles.length = 0;
                marbles.push({ dist: PATH_LENGTH - 1, color: 'red' });
                for (let i = 0; i < 60; i++) update(0.05);
            });
            await expect(page.locator('#overlay')).toHaveClass(/visible/);
            await expect(page.locator('#overlay-title')).toContainText(/game over/i);
            await expect(page.locator('#overlay-score')).toContainText('1234');
        });

        test('the best score is kept after a game over', async ({ page }) => {
            await page.evaluate(() => {
                startGame();
                score = 777;
                marbles.length = 0;
                marbles.push({ dist: PATH_LENGTH - 1, color: 'red' });
                for (let i = 0; i < 60; i++) update(0.05);
            });
            await expect(page.locator('#best')).toHaveText('777');
            expect(await page.evaluate(() => window.localStorage.getItem('zuma-best'))).toBe('777');
        });

        test('the game does not update once it is over', async ({ page }) => {
            const same = await page.evaluate(() => {
                startGame();
                marbles.length = 0;
                marbles.push({ dist: PATH_LENGTH - 1, color: 'red' });
                for (let i = 0; i < 60; i++) update(0.05);
                const before = marbles.map((m) => m.dist);
                for (let i = 0; i < 60; i++) update(0.05);
                return JSON.stringify(before) === JSON.stringify(marbles.map((m) => m.dist));
            });
            expect(same).toBe(true);
        });

        test('the danger warning appears when the chain nears the hole', async ({ page }) => {
            const s = await page.evaluate(() => {
                startGame();
                marbles.length = 0;
                marbles.push({ dist: 10, color: 'red' });
                update(0.016);
                const calm = inDanger();
                marbles[0].dist = PATH_LENGTH - 40;
                update(0.016);
                return { calm, hot: inDanger() };
            });
            expect(s.calm).toBe(false);
            expect(s.hot).toBe(true);
        });
    });

    // -----------------------------------------------------------------------
    // Pause / restart
    // -----------------------------------------------------------------------
    test.describe('pause and restart', () => {
        test('P pauses and resumes', async ({ page }) => {
            await page.evaluate(() => startGame());
            await page.keyboard.press('p');
            expect(await page.evaluate(() => state)).toBe('paused');
            await page.keyboard.press('p');
            expect(await page.evaluate(() => state)).toBe('running');
        });

        test('a paused game does not advance', async ({ page }) => {
            const same = await page.evaluate(() => {
                setSeed(6);
                startGame();
                for (let i = 0; i < 40; i++) update(0.05);
                togglePause();
                const before = marbles.map((m) => m.dist);
                for (let i = 0; i < 40; i++) update(0.05);
                return JSON.stringify(before) === JSON.stringify(marbles.map((m) => m.dist));
            });
            expect(same).toBe(true);
        });

        test('the pause overlay explains how to resume', async ({ page }) => {
            await page.evaluate(() => startGame());
            await page.keyboard.press('p');
            await expect(page.locator('#overlay')).toHaveClass(/visible/);
            await expect(page.locator('#overlay-title')).toContainText(/paused/i);
        });

        test('R restarts from level 1', async ({ page }) => {
            await page.evaluate(() => {
                startGame();
                score = 500;
                level = 3;
            });
            await page.keyboard.press('r');
            const s = await page.evaluate(() => ({ score, level, state }));
            expect(s.score).toBe(0);
            expect(s.level).toBe(1);
            expect(s.state).toBe('running');
        });

        test('Space restarts after a game over', async ({ page }) => {
            await page.evaluate(() => {
                startGame();
                marbles.length = 0;
                marbles.push({ dist: PATH_LENGTH - 1, color: 'red' });
                for (let i = 0; i < 60; i++) update(0.05);
            });
            await page.keyboard.press('Space');
            const s = await page.evaluate(() => ({ state, score, level }));
            expect(s.state).toBe('running');
            expect(s.score).toBe(0);
            expect(s.level).toBe(1);
        });
    });

    // -----------------------------------------------------------------------
    // Determinism / rendering smoke tests
    // -----------------------------------------------------------------------
    test.describe('rendering and determinism', () => {
        test('the same seed produces the same level', async ({ page }) => {
            const s = await page.evaluate(() => {
                setSeed(42);
                startGame();
                const a = spawnQueue.join(',');
                setSeed(42);
                startGame();
                return { a, b: spawnQueue.join(',') };
            });
            expect(s.a).toBe(s.b);
        });

        test('different seeds produce different levels', async ({ page }) => {
            const s = await page.evaluate(() => {
                setSeed(1);
                startGame();
                const a = spawnQueue.join(',');
                setSeed(2);
                startGame();
                return { a, b: spawnQueue.join(',') };
            });
            expect(s.a).not.toBe(s.b);
        });

        test('the canvas is painted after starting', async ({ page }) => {
            const painted = await page.evaluate(() => {
                setSeed(8);
                startGame();
                for (let i = 0; i < 60; i++) update(0.05);
                draw();
                const ctx = document.getElementById('canvas').getContext('2d');
                const data = ctx.getImageData(0, 0, CANVAS_W, CANVAS_H).data;
                const seen = new Set();
                for (let i = 0; i < data.length; i += 4) {
                    seen.add(`${data[i]},${data[i + 1]},${data[i + 2]}`);
                }
                return seen.size;
            });
            expect(painted).toBeGreaterThan(10);
        });

        test('a long unattended run always ends in game over, never a crash', async ({ page }) => {
            const errors = [];
            page.on('pageerror', (e) => errors.push(e.message));
            const s = await page.evaluate(() => {
                setSeed(13);
                startGame();
                for (let i = 0; i < 4000 && state === 'running'; i++) update(0.05);
                return state;
            });
            expect(errors).toEqual([]);
            expect(s).toBe('gameover');
        });

        test('the score display tracks the score', async ({ page }) => {
            await page.evaluate(() => {
                startGame();
                score = 0;
                marbles.length = 0;
                marbles.push({ dist: 400, color: 'red' }, { dist: 400 - MARBLE_SPACING, color: 'red' });
                insertMarble(0, 'red');
            });
            await expect(page.locator('#score')).not.toHaveText('0');
        });
    });
});
