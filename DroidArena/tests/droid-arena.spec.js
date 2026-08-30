const { test, expect } = require('@playwright/test');
const path = require('path');
const { pathToFileURL } = require('url');

const GAME_URL = pathToFileURL(path.resolve(__dirname, '../index.html')).href;

test.describe('Droid Arena', () => {
    test.beforeEach(async ({ page }) => {
        await page.goto(GAME_URL);
    });

    // -----------------------------------------------------------------------
    // Initial / idle state
    // -----------------------------------------------------------------------
    test.describe('initial state', () => {
        test('page title is Droid Arena', async ({ page }) => {
            await expect(page).toHaveTitle('Droid Arena');
        });

        test('canvas is 640x480', async ({ page }) => {
            const canvas = page.locator('#canvas');
            await expect(canvas).toHaveAttribute('width', '640');
            await expect(canvas).toHaveAttribute('height', '480');
        });

        test('start overlay is visible and prompts the player', async ({ page }) => {
            await expect(page.locator('#overlay')).toHaveClass(/visible/);
            await expect(page.locator('#overlay-sub')).toContainText(/space|start/i);
        });

        test('HUD starts at zero score, full lives, wave 1', async ({ page }) => {
            await expect(page.locator('#score')).toHaveText('0');
            await expect(page.locator('#lives')).toHaveText('3');
            await expect(page.locator('#wave')).toHaveText('1');
        });

        test('state is idle before starting', async ({ page }) => {
            expect(await page.evaluate(() => state)).toBe('idle');
        });

        test('no entities exist before starting', async ({ page }) => {
            const counts = await page.evaluate(() => ({
                enemies: enemies.length,
                humans: humans.length,
                bullets: bullets.length,
            }));
            expect(counts).toEqual({ enemies: 0, humans: 0, bullets: 0 });
        });

        test('stepping while idle does nothing', async ({ page }) => {
            const moved = await page.evaluate(() => {
                setMove(1, 0);
                const before = player.x;
                for (let i = 0; i < 30; i++) step(0.016);
                return player.x !== before;
            });
            expect(moved).toBe(false);
        });

        test('high score loads from localStorage', async ({ page }) => {
            await page.evaluate(() => window.localStorage.setItem('droid-arena-best', '31337'));
            await page.reload();
            await expect(page.locator('#best')).toHaveText('31337');
        });

        test('the arena walls sit inside the canvas', async ({ page }) => {
            const geom = await page.evaluate(() => ({ w: CANVAS_W, h: CANVAS_H, wall: WALL }));
            expect(geom.w).toBe(640);
            expect(geom.h).toBe(480);
            expect(geom.wall).toBeGreaterThan(0);
            expect(geom.wall).toBeLessThan(geom.h / 4);
        });
    });

    // -----------------------------------------------------------------------
    // Starting a run
    // -----------------------------------------------------------------------
    test.describe('starting', () => {
        test('Space starts the game and hides the overlay', async ({ page }) => {
            await page.keyboard.press('Space');
            expect(await page.evaluate(() => state)).toBe('running');
            await expect(page.locator('#overlay')).not.toHaveClass(/visible/);
        });

        test('the start button starts the game', async ({ page }) => {
            await page.locator('#btn-start').click();
            expect(await page.evaluate(() => state)).toBe('running');
        });

        test('starting spawns wave 1 droids and civilians', async ({ page }) => {
            const counts = await page.evaluate(() => {
                startGame();
                return { enemies: enemies.length, humans: humans.length, wave };
            });
            expect(counts.wave).toBe(1);
            expect(counts.enemies).toBeGreaterThan(0);
            expect(counts.humans).toBeGreaterThan(0);
        });

        test('the player starts in the centre of the arena', async ({ page }) => {
            const pos = await page.evaluate(() => {
                startGame();
                return { x: player.x, y: player.y, cx: CANVAS_W / 2, cy: CANVAS_H / 2 };
            });
            expect(pos.x).toBe(pos.cx);
            expect(pos.y).toBe(pos.cy);
        });

        test('nothing spawns on top of the player', async ({ page }) => {
            const nearest = await page.evaluate(() => {
                startGame();
                let worst = Infinity;
                for (let w = 1; w <= 6; w++) {
                    spawnWave(w);
                    for (const e of enemies.concat(humans)) {
                        worst = Math.min(worst, Math.hypot(e.x - player.x, e.y - player.y));
                    }
                }
                return { worst, min: MIN_SPAWN_DIST };
            });
            expect(nearest.worst).toBeGreaterThanOrEqual(nearest.min - 0.001);
        });

        test('everything spawns inside the arena walls', async ({ page }) => {
            const inside = await page.evaluate(() => {
                startGame();
                for (let w = 1; w <= 6; w++) spawnWave(w);
                return enemies.concat(humans).every((e) => (
                    e.x > WALL && e.x < CANVAS_W - WALL && e.y > WALL && e.y < CANVAS_H - WALL
                ));
            });
            expect(inside).toBe(true);
        });
    });

    // -----------------------------------------------------------------------
    // Movement
    // -----------------------------------------------------------------------
    test.describe('movement', () => {
        test('the player moves in the direction held', async ({ page }) => {
            const result = await page.evaluate(() => {
                startGame();
                const x0 = player.x;
                setMove(1, 0);
                for (let i = 0; i < 10; i++) step(0.01);
                return { delta: player.x - x0, expected: PLAYER_SPEED * 0.1 };
            });
            expect(result.delta).toBeCloseTo(result.expected, 3);
        });

        test('diagonal movement is normalised, not faster', async ({ page }) => {
            const result = await page.evaluate(() => {
                startGame();
                const x0 = player.x, y0 = player.y;
                setMove(1, 1);
                step(0.1);
                return { speed: Math.hypot(player.x - x0, player.y - y0) / 0.1, expected: PLAYER_SPEED };
            });
            expect(result.speed).toBeCloseTo(result.expected, 3);
        });

        test('the player cannot leave the arena', async ({ page }) => {
            const pos = await page.evaluate(() => {
                startGame();
                setMove(-1, -1);
                for (let i = 0; i < 400; i++) step(0.02);
                return { x: player.x, y: player.y, min: WALL + PLAYER_R };
            });
            expect(pos.x).toBeGreaterThanOrEqual(pos.min - 0.001);
            expect(pos.y).toBeGreaterThanOrEqual(pos.min - 0.001);
        });

        test('releasing the keys stops the player', async ({ page }) => {
            const moved = await page.evaluate(() => {
                startGame();
                setMove(1, 0);
                step(0.1);
                setMove(0, 0);
                const x = player.x;
                for (let i = 0; i < 20; i++) step(0.02);
                return player.x !== x;
            });
            expect(moved).toBe(false);
        });
    });

    // -----------------------------------------------------------------------
    // Shooting
    // -----------------------------------------------------------------------
    test.describe('shooting', () => {
        test('aiming fires a bullet in that direction', async ({ page }) => {
            const shot = await page.evaluate(() => {
                startGame();
                clearEntities();
                setAim(1, 0);
                step(0.016);
                return { n: bullets.length, vx: bullets[0].vx, vy: bullets[0].vy };
            });
            expect(shot.n).toBe(1);
            expect(shot.vx).toBeGreaterThan(0);
            expect(shot.vy).toBeCloseTo(0, 5);
        });

        test('bullets leave at BULLET_SPEED', async ({ page }) => {
            const result = await page.evaluate(() => {
                startGame();
                clearEntities();
                setAim(0, -1);
                step(0.016);
                return { speed: Math.hypot(bullets[0].vx, bullets[0].vy), expected: BULLET_SPEED };
            });
            expect(result.speed).toBeCloseTo(result.expected, 3);
        });

        test('diagonal shots are normalised', async ({ page }) => {
            const result = await page.evaluate(() => {
                startGame();
                clearEntities();
                setAim(-1, 1);
                step(0.016);
                return { speed: Math.hypot(bullets[0].vx, bullets[0].vy), expected: BULLET_SPEED };
            });
            expect(result.speed).toBeCloseTo(result.expected, 3);
        });

        test('the fire rate is limited by FIRE_INTERVAL', async ({ page }) => {
            const counts = await page.evaluate(() => {
                startGame();
                clearEntities();
                setAim(1, 0);
                step(0.016);
                const afterFirst = bullets.length;
                step(FIRE_INTERVAL / 4);
                const tooSoon = bullets.length;
                step(FIRE_INTERVAL);
                return { afterFirst, tooSoon, afterWait: bullets.length };
            });
            expect(counts.afterFirst).toBe(1);
            expect(counts.tooSoon).toBe(1);
            expect(counts.afterWait).toBe(2);
        });

        test('not aiming fires nothing', async ({ page }) => {
            const n = await page.evaluate(() => {
                startGame();
                clearEntities();
                setAim(0, 0);
                for (let i = 0; i < 60; i++) step(0.016);
                return bullets.length;
            });
            expect(n).toBe(0);
        });

        test('bullets travel and are removed at the wall', async ({ page }) => {
            const result = await page.evaluate(() => {
                startGame();
                clearEntities();
                setAim(1, 0);
                step(0.016);
                const x0 = bullets[0].x;
                setAim(0, 0);
                step(0.05);
                const travelled = bullets[0].x - x0;
                for (let i = 0; i < 60; i++) step(0.016);
                return { travelled, remaining: bullets.length };
            });
            expect(result.travelled).toBeGreaterThan(0);
            expect(result.remaining).toBe(0);
        });
    });

    // -----------------------------------------------------------------------
    // Droids
    // -----------------------------------------------------------------------
    test.describe('droids', () => {
        test('grunts walk toward the player', async ({ page }) => {
            const closed = await page.evaluate(() => {
                startGame();
                clearEntities();
                player.invuln = 999;
                const g = spawnGrunt(600, 400);
                const before = Math.hypot(g.x - player.x, g.y - player.y);
                for (let i = 0; i < 60; i++) step(1 / 60);
                return before - Math.hypot(g.x - player.x, g.y - player.y);
            });
            expect(closed).toBeGreaterThan(20);
        });

        test('grunts get faster on later waves, up to a cap', async ({ page }) => {
            const speeds = await page.evaluate(() => ({
                early: gruntSpeed(1),
                late: gruntSpeed(8),
                huge: gruntSpeed(99),
                cap: GRUNT_MAX_SPEED,
            }));
            expect(speeds.late).toBeGreaterThan(speeds.early);
            expect(speeds.huge).toBe(speeds.cap);
        });

        test('a bullet destroys a grunt and scores SCORE_GRUNT', async ({ page }) => {
            const result = await page.evaluate(() => {
                startGame();
                clearEntities();
                score = 0;
                spawnGrunt(player.x + 60, player.y);
                setAim(1, 0);
                for (let i = 0; i < 20; i++) step(1 / 60);
                return { enemies: enemies.length, score, expected: SCORE_GRUNT };
            });
            expect(result.enemies).toBe(0);
            expect(result.score).toBe(result.expected);
        });

        test('a bullet destroys a sentry and scores SCORE_SENTRY', async ({ page }) => {
            const result = await page.evaluate(() => {
                startGame();
                clearEntities();
                score = 0;
                spawnSentry(player.x + 60, player.y);
                setAim(1, 0);
                for (let i = 0; i < 20; i++) step(1 / 60);
                return { enemies: enemies.length, score, expected: SCORE_SENTRY };
            });
            expect(result.enemies).toBe(0);
            expect(result.score).toBe(result.expected);
        });

        test('the bullet is consumed by the droid it kills', async ({ page }) => {
            const remaining = await page.evaluate(() => {
                startGame();
                clearEntities();
                spawnGrunt(player.x + 60, player.y);
                setAim(1, 0);
                step(1 / 60);
                setAim(0, 0);
                for (let i = 0; i < 20; i++) step(1 / 60);
                return bullets.length;
            });
            expect(remaining).toBe(0);
        });

        test('hulks are indestructible but get knocked back', async ({ page }) => {
            const result = await page.evaluate(() => {
                startGame();
                clearEntities();
                score = 0;
                const h = spawnHulk(player.x + 70, player.y);
                h.vx = 0;
                h.vy = 0;
                h.turnTimer = 999;
                const x0 = h.x;
                setAim(1, 0);
                for (let i = 0; i < 15; i++) step(1 / 60);
                return { enemies: enemies.length, score, pushed: h.x - x0 };
            });
            expect(result.enemies).toBe(1);
            expect(result.score).toBe(0);
            expect(result.pushed).toBeGreaterThan(0);
        });

        test('hulks move along one axis at a time', async ({ page }) => {
            const axisAligned = await page.evaluate(() => {
                startGame();
                clearEntities();
                player.invuln = 999;
                const h = spawnHulk(200, 200);
                let ok = true;
                for (let i = 0; i < 300; i++) {
                    step(1 / 60);
                    if (h.vx !== 0 && h.vy !== 0) ok = false;
                }
                return ok;
            });
            expect(axisAligned).toBe(true);
        });

        test('droids stay inside the arena', async ({ page }) => {
            const inside = await page.evaluate(() => {
                startGame();
                for (let i = 0; i < 600; i++) step(1 / 60);
                return enemies.every((e) => (
                    e.x >= WALL - 1 && e.x <= CANVAS_W - WALL + 1 &&
                    e.y >= WALL - 1 && e.y <= CANVAS_H - WALL + 1
                ));
            });
            expect(inside).toBe(true);
        });

        test('sentries shoot at the player', async ({ page }) => {
            const fired = await page.evaluate(() => {
                startGame();
                clearEntities();
                player.invuln = 999;
                spawnSentry(player.x + 150, player.y);
                for (let i = 0; i < 60 * 4; i++) step(1 / 60);
                return enemyBullets.length;
            });
            expect(fired).toBeGreaterThan(0);
        });

        test('sentry bullets fly toward the player', async ({ page }) => {
            const closing = await page.evaluate(() => {
                startGame();
                clearEntities();
                player.invuln = 999;
                spawnSentry(player.x + 150, player.y);
                for (let i = 0; i < 60 * 4; i++) step(1 / 60);
                return enemyBullets.length > 0 && enemyBullets[0].vx < 0;
            });
            expect(closing).toBe(true);
        });
    });

    // -----------------------------------------------------------------------
    // Civilians
    // -----------------------------------------------------------------------
    test.describe('civilians', () => {
        test('walking into a civilian rescues them for 1000', async ({ page }) => {
            const result = await page.evaluate(() => {
                startGame();
                clearEntities();
                score = 0;
                spawnHuman(player.x + 4, player.y);
                step(1 / 60);
                return { humans: humans.length, score };
            });
            expect(result.humans).toBe(0);
            expect(result.score).toBe(1000);
        });

        test('consecutive rescues escalate and cap at 5000', async ({ page }) => {
            const values = await page.evaluate(() => {
                startGame();
                clearEntities();
                score = 0;
                const gained = [];
                for (let i = 0; i < 7; i++) {
                    const before = score;
                    spawnHuman(player.x + 4, player.y);
                    step(1 / 60);
                    gained.push(score - before);
                }
                return gained;
            });
            expect(values).toEqual([1000, 2000, 3000, 4000, 5000, 5000, 5000]);
        });

        test('the rescue chain resets on a new wave', async ({ page }) => {
            const gained = await page.evaluate(() => {
                startGame();
                clearEntities();
                player.invuln = 999;
                spawnHuman(player.x + 4, player.y);
                step(1 / 60);                                   // rescue #1 (1000)
                spawnHuman(player.x + 4, player.y);
                step(1 / 60);                                   // rescue #2 (2000)
                for (let i = 0; i < 120; i++) step(1 / 60);     // wave clears
                humans.length = 0;
                score = 0;
                spawnHuman(player.x + 4, player.y);
                step(1 / 60);
                return score;
            });
            expect(gained).toBe(1000);
        });

        test('hulks trample civilians without scoring', async ({ page }) => {
            const result = await page.evaluate(() => {
                startGame();
                clearEntities();
                score = 0;
                spawnHulk(200, 200);
                spawnHuman(202, 200);
                step(1 / 60);
                return { humans: humans.length, score };
            });
            expect(result.humans).toBe(0);
            expect(result.score).toBe(0);
        });

        test('grunts do not harm civilians', async ({ page }) => {
            const remaining = await page.evaluate(() => {
                startGame();
                clearEntities();
                spawnGrunt(200, 200);
                spawnHuman(202, 200);
                step(1 / 60);
                return humans.length;
            });
            expect(remaining).toBe(1);
        });

        test('civilians wander but stay inside the arena', async ({ page }) => {
            const result = await page.evaluate(() => {
                startGame();
                clearEntities();
                player.invuln = 999;
                const h = spawnHuman(120, 120);
                const x0 = h.x, y0 = h.y;
                let inside = true;
                for (let i = 0; i < 60; i++) {
                    step(1 / 60);
                    if (h.x < WALL || h.x > CANVAS_W - WALL || h.y < WALL || h.y > CANVAS_H - WALL) inside = false;
                }
                return { inside, moved: Math.hypot(h.x - x0, h.y - y0) };
            });
            expect(result.inside).toBe(true);
            expect(result.moved).toBeGreaterThan(0);
        });
    });

    // -----------------------------------------------------------------------
    // Dying
    // -----------------------------------------------------------------------
    test.describe('dying', () => {
        test('touching a droid costs a life', async ({ page }) => {
            const result = await page.evaluate(() => {
                startGame();
                clearEntities();
                player.invuln = 0;
                spawnGrunt(player.x + 3, player.y);
                step(1 / 60);
                return { lives, state };
            });
            expect(result.lives).toBe(2);
            expect(result.state).toBe('running');
        });

        test('an enemy bullet costs a life', async ({ page }) => {
            const result = await page.evaluate(() => {
                startGame();
                clearEntities();
                player.invuln = 0;
                enemyBullets.push({ x: player.x + 2, y: player.y, vx: 0, vy: 0 });
                step(1 / 60);
                return { lives, bullets: enemyBullets.length };
            });
            expect(result.lives).toBe(2);
            expect(result.bullets).toBe(0);
        });

        test('dying respawns the player in the centre with invulnerability', async ({ page }) => {
            const result = await page.evaluate(() => {
                startGame();
                clearEntities();
                player.invuln = 0;
                player.x = 100;
                player.y = 100;
                spawnGrunt(103, 100);
                step(1 / 60);
                return { x: player.x, y: player.y, invuln: player.invuln, cx: CANVAS_W / 2, cy: CANVAS_H / 2 };
            });
            expect(result.x).toBe(result.cx);
            expect(result.y).toBe(result.cy);
            expect(result.invuln).toBeGreaterThan(0);
        });

        test('the invulnerable player survives contact', async ({ page }) => {
            const result = await page.evaluate(() => {
                startGame();
                clearEntities();
                player.invuln = 5;
                spawnGrunt(player.x + 3, player.y);
                for (let i = 0; i < 30; i++) step(1 / 60);
                return { lives, state };
            });
            expect(result.lives).toBe(3);
            expect(result.state).toBe('running');
        });

        test('invulnerability wears off', async ({ page }) => {
            const after = await page.evaluate(() => {
                startGame();
                clearEntities();
                player.invuln = 0.2;
                for (let i = 0; i < 30; i++) step(1 / 60);
                return player.invuln;
            });
            expect(after).toBe(0);
        });

        test('dying rebuilds the wave', async ({ page }) => {
            const result = await page.evaluate(() => {
                startGame();
                clearEntities();
                player.invuln = 0;
                spawnGrunt(player.x + 3, player.y);
                step(1 / 60);
                return { enemies: enemies.length, humans: humans.length, wave };
            });
            expect(result.wave).toBe(1);
            expect(result.enemies).toBeGreaterThan(0);
            expect(result.humans).toBeGreaterThan(0);
        });

        test('losing the last life ends the game', async ({ page }) => {
            const result = await page.evaluate(() => {
                startGame();
                lives = 1;
                clearEntities();
                player.invuln = 0;
                spawnGrunt(player.x + 3, player.y);
                step(1 / 60);
                return { state, lives };
            });
            expect(result.state).toBe('over');
            expect(result.lives).toBe(0);
        });

        test('game over shows the overlay with the final score', async ({ page }) => {
            await page.evaluate(() => {
                startGame();
                score = 4200;
                lives = 1;
                clearEntities();
                player.invuln = 0;
                spawnGrunt(player.x + 3, player.y);
                step(1 / 60);
            });
            await expect(page.locator('#overlay')).toHaveClass(/visible/);
            await expect(page.locator('#overlay-title')).toContainText(/over/i);
            await expect(page.locator('#overlay-score')).toContainText('4200');
        });

        test('the game stops simulating once it is over', async ({ page }) => {
            const moved = await page.evaluate(() => {
                startGame();
                lives = 1;
                clearEntities();
                player.invuln = 0;
                spawnGrunt(player.x + 3, player.y);
                step(1 / 60);
                setMove(1, 0);
                const x = player.x;
                for (let i = 0; i < 20; i++) step(1 / 60);
                return player.x !== x;
            });
            expect(moved).toBe(false);
        });

        test('the high score is saved on game over', async ({ page }) => {
            const stored = await page.evaluate(() => {
                startGame();
                score = 7777;
                lives = 1;
                clearEntities();
                player.invuln = 0;
                spawnGrunt(player.x + 3, player.y);
                step(1 / 60);
                return window.localStorage.getItem('droid-arena-best');
            });
            expect(stored).toBe('7777');
            await expect(page.locator('#best')).toHaveText('7777');
        });

        test('a lower score does not overwrite the high score', async ({ page }) => {
            await page.evaluate(() => window.localStorage.setItem('droid-arena-best', '50000'));
            await page.reload();
            const stored = await page.evaluate(() => {
                startGame();
                score = 10;
                lives = 1;
                clearEntities();
                player.invuln = 0;
                spawnGrunt(player.x + 3, player.y);
                step(1 / 60);
                return window.localStorage.getItem('droid-arena-best');
            });
            expect(stored).toBe('50000');
        });
    });

    // -----------------------------------------------------------------------
    // Waves & scoring
    // -----------------------------------------------------------------------
    test.describe('waves', () => {
        test('clearing every destructible droid advances the wave', async ({ page }) => {
            const result = await page.evaluate(() => {
                startGame();
                clearEntities();
                player.invuln = 999;
                for (let i = 0; i < 120; i++) step(1 / 60);
                return { wave, enemies: enemies.length, humans: humans.length };
            });
            expect(result.wave).toBe(2);
            expect(result.enemies).toBeGreaterThan(0);
            expect(result.humans).toBeGreaterThan(0);
        });

        test('the next wave arrives after a short pause, not instantly', async ({ page }) => {
            const result = await page.evaluate(() => {
                startGame();
                clearEntities();
                player.invuln = 999;
                step(1 / 60);
                const immediately = wave;
                for (let i = 0; i < 120; i++) step(1 / 60);
                return { immediately, later: wave, delay: WAVE_CLEAR_DELAY };
            });
            expect(result.immediately).toBe(1);
            expect(result.later).toBe(2);
            expect(result.delay).toBeGreaterThan(0);
        });

        test('a surviving hulk does not hold the wave open', async ({ page }) => {
            const result = await page.evaluate(() => {
                startGame();
                clearEntities();
                player.invuln = 999;
                spawnHulk(600, 60);
                for (let i = 0; i < 120; i++) step(1 / 60);
                return wave;
            });
            expect(result).toBe(2);
        });

        test('a surviving grunt holds the wave open', async ({ page }) => {
            const result = await page.evaluate(() => {
                startGame();
                clearEntities();
                player.invuln = 999;
                spawnGrunt(600, 60);
                for (let i = 0; i < 120; i++) step(1 / 60);
                return wave;
            });
            expect(result).toBe(1);
        });

        test('later waves are bigger and add hulks and sentries', async ({ page }) => {
            const shape = await page.evaluate(() => {
                startGame();
                const at = (w) => {
                    spawnWave(w);
                    const count = (t) => enemies.filter((e) => e.type === t).length;
                    return { grunts: count('grunt'), hulks: count('hulk'), sentries: count('sentry') };
                };
                return { w1: at(1), w2: at(2), w5: at(5) };
            });
            expect(shape.w1.hulks).toBe(0);
            expect(shape.w1.sentries).toBe(0);
            expect(shape.w2.grunts).toBeGreaterThan(shape.w1.grunts);
            expect(shape.w2.hulks).toBeGreaterThan(0);
            expect(shape.w2.sentries).toBeGreaterThan(0);
            expect(shape.w5.grunts).toBeGreaterThan(shape.w2.grunts);
        });

        test('the wave counter is shown in the HUD', async ({ page }) => {
            await page.evaluate(() => {
                startGame();
                clearEntities();
                player.invuln = 999;
                for (let i = 0; i < 120; i++) step(1 / 60);
            });
            await expect(page.locator('#wave')).toHaveText('2');
        });

        test('score is shown in the HUD', async ({ page }) => {
            await page.evaluate(() => {
                startGame();
                clearEntities();
                score = 0;
                spawnGrunt(player.x + 60, player.y);
                setAim(1, 0);
                for (let i = 0; i < 20; i++) step(1 / 60);
            });
            await expect(page.locator('#score')).toHaveText('100');
        });

        test('an extra life is awarded every EXTRA_LIFE_EVERY points', async ({ page }) => {
            const result = await page.evaluate(() => {
                startGame();
                clearEntities();
                score = EXTRA_LIFE_EVERY - 1000;
                spawnHuman(player.x + 4, player.y);   // +1000 crosses the threshold
                step(1 / 60);
                return { lives, score, threshold: EXTRA_LIFE_EVERY };
            });
            expect(result.score).toBeGreaterThanOrEqual(result.threshold);
            expect(result.lives).toBe(4);
        });

        test('the lives display tracks the life count', async ({ page }) => {
            await page.evaluate(() => {
                startGame();
                clearEntities();
                player.invuln = 0;
                spawnGrunt(player.x + 3, player.y);
                step(1 / 60);
            });
            await expect(page.locator('#lives')).toHaveText('2');
        });
    });

    // -----------------------------------------------------------------------
    // Pause & restart
    // -----------------------------------------------------------------------
    test.describe('pause and restart', () => {
        test('P pauses and resumes', async ({ page }) => {
            await page.evaluate(() => startGame());
            await page.keyboard.press('p');
            expect(await page.evaluate(() => state)).toBe('paused');
            await page.keyboard.press('p');
            expect(await page.evaluate(() => state)).toBe('running');
        });

        test('the paused overlay is shown', async ({ page }) => {
            await page.evaluate(() => startGame());
            await page.keyboard.press('p');
            await expect(page.locator('#overlay')).toHaveClass(/visible/);
            await expect(page.locator('#overlay-title')).toContainText(/pause/i);
        });

        test('nothing moves while paused', async ({ page }) => {
            const moved = await page.evaluate(() => {
                startGame();
                togglePause();
                setMove(1, 0);
                const x = player.x;
                for (let i = 0; i < 30; i++) step(1 / 60);
                return player.x !== x;
            });
            expect(moved).toBe(false);
        });

        test('P does nothing before the game starts', async ({ page }) => {
            await page.keyboard.press('p');
            expect(await page.evaluate(() => state)).toBe('idle');
        });

        test('Space restarts after game over with a clean slate', async ({ page }) => {
            await page.evaluate(() => {
                startGame();
                score = 999;
                wave = 4;
                lives = 1;
                clearEntities();
                player.invuln = 0;
                spawnGrunt(player.x + 3, player.y);
                step(1 / 60);
            });
            await page.keyboard.press('Space');
            const fresh = await page.evaluate(() => ({ state, score, lives, wave }));
            expect(fresh).toEqual({ state: 'running', score: 0, lives: 3, wave: 1 });
        });
    });

    // -----------------------------------------------------------------------
    // Keyboard bindings
    // -----------------------------------------------------------------------
    test.describe('keyboard', () => {
        test('WASD moves the player', async ({ page }) => {
            await page.evaluate(() => startGame());
            await page.keyboard.down('d');
            const moved = await page.evaluate(() => {
                const x = player.x;
                for (let i = 0; i < 10; i++) step(1 / 60);
                return player.x - x;
            });
            await page.keyboard.up('d');
            expect(moved).toBeGreaterThan(0);
        });

        test('releasing a movement key stops the player', async ({ page }) => {
            await page.evaluate(() => startGame());
            await page.keyboard.down('w');
            await page.keyboard.up('w');
            const moved = await page.evaluate(() => {
                const y = player.y;
                for (let i = 0; i < 10; i++) step(1 / 60);
                return player.y !== y;
            });
            expect(moved).toBe(false);
        });

        test('arrow keys aim and fire', async ({ page }) => {
            await page.evaluate(() => { startGame(); clearEntities(); });
            await page.keyboard.down('ArrowLeft');
            const shot = await page.evaluate(() => {
                // The real frame loop is running too, so give the fire cooldown
                // a full interval to come round.
                bullets.length = 0;
                for (let i = 0; i < 20 && !bullets.length; i++) step(1 / 60);
                return bullets.length ? bullets[0].vx : 0;
            });
            await page.keyboard.up('ArrowLeft');
            expect(shot).toBeLessThan(0);
        });

        test('move and aim are independent', async ({ page }) => {
            await page.evaluate(() => { startGame(); clearEntities(); });
            await page.keyboard.down('a');
            await page.keyboard.down('ArrowRight');
            const result = await page.evaluate(() => {
                bullets.length = 0;
                player.x = CANVAS_W / 2;
                const x = player.x;
                for (let i = 0; i < 20 && !bullets.length; i++) step(1 / 60);
                return { drift: player.x - x, shot: bullets.length ? bullets[0].vx : 0 };
            });
            await page.keyboard.up('a');
            await page.keyboard.up('ArrowRight');
            expect(result.drift).toBeLessThan(0);
            expect(result.shot).toBeGreaterThan(0);
        });

        test('arrow keys do not scroll the page', async ({ page }) => {
            await page.evaluate(() => startGame());
            const defaultPrevented = await page.evaluate(() => new Promise((resolve) => {
                window.addEventListener('keydown', (e) => resolve(e.defaultPrevented), { once: true });
                window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', cancelable: true, bubbles: true }));
            }));
            expect(defaultPrevented).toBe(true);
        });
    });

    // -----------------------------------------------------------------------
    // Rendering & robustness
    // -----------------------------------------------------------------------
    test.describe('rendering', () => {
        test('the canvas is painted', async ({ page }) => {
            const painted = await page.evaluate(() => {
                startGame();
                draw();
                const data = ctx.getImageData(0, 0, CANVAS_W, CANVAS_H).data;
                for (let i = 3; i < data.length; i += 4) if (data[i] !== 0) return true;
                return false;
            });
            expect(painted).toBe(true);
        });

        test('a long play session raises no console errors', async ({ page }) => {
            const errors = [];
            page.on('pageerror', (e) => errors.push(String(e)));
            page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
            await page.evaluate(() => {
                startGame();
                setMove(1, 1);
                setAim(-1, 0);
                for (let i = 0; i < 60 * 30; i++) { step(1 / 60); if (i % 60 === 0) draw(); }
            });
            expect(errors).toEqual([]);
        });

        test('the simulation survives large time steps', async ({ page }) => {
            const ok = await page.evaluate(() => {
                startGame();
                setMove(1, 0);
                setAim(0, 1);
                for (let i = 0; i < 40; i++) step(0.05);
                return Number.isFinite(player.x) && Number.isFinite(player.y) &&
                    enemies.every((e) => Number.isFinite(e.x) && Number.isFinite(e.y));
            });
            expect(ok).toBe(true);
        });

        test('a rescue leaves a floating score popup that fades', async ({ page }) => {
            const result = await page.evaluate(() => {
                startGame();
                clearEntities();
                spawnHuman(player.x + 4, player.y);
                step(1 / 60);
                const shown = popups.map((p) => p.text);
                for (let i = 0; i < 300; i++) step(1 / 60);
                return { shown, after: popups.length };
            });
            expect(result.shown).toEqual(['1000']);
            expect(result.after).toBe(0);
        });

        test('particles fade away', async ({ page }) => {
            const result = await page.evaluate(() => {
                startGame();
                clearEntities();
                player.invuln = 999;
                spawnGrunt(player.x + 60, player.y);
                setAim(1, 0);
                for (let i = 0; i < 20; i++) step(1 / 60);
                const peak = particles.length;
                setAim(0, 0);
                for (let i = 0; i < 300; i++) step(1 / 60);
                return { peak, after: particles.length };
            });
            expect(result.peak).toBeGreaterThan(0);
            expect(result.after).toBe(0);
        });
    });
});
