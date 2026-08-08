const { test, expect } = require('@playwright/test');
const path = require('path');
const { pathToFileURL } = require('url');

const GAME_URL = pathToFileURL(path.resolve(__dirname, '../index.html')).href;

/** Advance the deterministic simulation by `frames` steps of `dt` seconds. */
const STEP = `(frames, dt) => { for (let i = 0; i < frames; i++) update(dt); }`;

test.describe('Defender', () => {
    test.beforeEach(async ({ page }) => {
        await page.goto(GAME_URL);
    });

    // -----------------------------------------------------------------------
    // Initial / idle state
    // -----------------------------------------------------------------------
    test.describe('initial state', () => {
        test('page title is Defender', async ({ page }) => {
            await expect(page).toHaveTitle('Defender');
        });

        test('canvas has the documented size', async ({ page }) => {
            const canvas = page.locator('#canvas');
            await expect(canvas).toHaveAttribute('width', '800');
            await expect(canvas).toHaveAttribute('height', '460');
        });

        test('start overlay is visible and explains how to start', async ({ page }) => {
            await expect(page.locator('#overlay')).toHaveClass(/visible/);
            await expect(page.locator('#overlay-sub')).toContainText(/space|start/i);
        });

        test('HUD starts at zero score, 3 lives, 3 bombs, wave 1', async ({ page }) => {
            await expect(page.locator('#score')).toHaveText('0');
            await expect(page.locator('#lives')).toHaveText('3');
            await expect(page.locator('#bombs')).toHaveText('3');
            await expect(page.locator('#wave')).toHaveText('1');
            await expect(page.locator('#best')).toHaveText('0');
        });

        test('state is idle and the world is empty before starting', async ({ page }) => {
            const s = await page.evaluate(() => ({
                state,
                landers: landers.length,
                mutants: mutants.length,
                bullets: bullets.length,
            }));
            expect(s).toEqual({ state: 'idle', landers: 0, mutants: 0, bullets: 0 });
        });

        test('best score loads from localStorage', async ({ page }) => {
            await page.evaluate(() => window.localStorage.setItem('defender-best', '4200'));
            await page.reload();
            await expect(page.locator('#best')).toHaveText('4200');
        });

        test('the world is wider than the visible canvas', async ({ page }) => {
            const s = await page.evaluate(() => ({ WORLD_W, CANVAS_W }));
            expect(s.WORLD_W).toBeGreaterThan(s.CANVAS_W * 2);
        });
    });

    // -----------------------------------------------------------------------
    // Terrain & world helpers
    // -----------------------------------------------------------------------
    test.describe('world helpers', () => {
        test('wrapX keeps coordinates inside the world', async ({ page }) => {
            const s = await page.evaluate(() => [
                wrapX(-10),
                wrapX(WORLD_W + 25),
                wrapX(WORLD_W),
                wrapX(123),
            ]);
            expect(s[0]).toBeCloseTo(3190, 3);
            expect(s[1]).toBeCloseTo(25, 3);
            expect(s[2]).toBeCloseTo(0, 3);
            expect(s[3]).toBeCloseTo(123, 3);
        });

        test('wrapDelta returns the shortest signed distance', async ({ page }) => {
            const s = await page.evaluate(() => [
                wrapDelta(10, 40),
                wrapDelta(40, 10),
                wrapDelta(10, WORLD_W - 10),
                wrapDelta(WORLD_W - 10, 10),
            ]);
            expect(s[0]).toBeCloseTo(30, 3);
            expect(s[1]).toBeCloseTo(-30, 3);
            expect(s[2]).toBeCloseTo(-20, 3);
            expect(s[3]).toBeCloseTo(20, 3);
        });

        test('terrain height stays inside the play field everywhere', async ({ page }) => {
            const ok = await page.evaluate(() => {
                for (let x = 0; x < WORLD_W; x += 7) {
                    const y = groundY(x);
                    if (!(y > PLAY_TOP + 100 && y < CANVAS_H)) return false;
                }
                return true;
            });
            expect(ok).toBe(true);
        });

        test('the same seed rebuilds the same terrain', async ({ page }) => {
            const same = await page.evaluate(() => {
                setSeed(99); buildTerrain();
                const a = terrain.slice();
                setSeed(99); buildTerrain();
                return a.every((v, i) => v === terrain[i]);
            });
            expect(same).toBe(true);
        });

        test('radarX maps the player to the centre of the scanner', async ({ page }) => {
            const s = await page.evaluate(() => {
                startGame();
                player.x = 1234;
                return { at: radarX(player.x), mid: CANVAS_W / 2 };
            });
            expect(s.at).toBeCloseTo(s.mid, 3);
        });
    });

    // -----------------------------------------------------------------------
    // Starting a game
    // -----------------------------------------------------------------------
    test.describe('starting', () => {
        test('Space starts the game and hides the overlay', async ({ page }) => {
            await page.keyboard.press('Space');
            expect(await page.evaluate(() => state)).toBe('running');
            await expect(page.locator('#overlay')).not.toHaveClass(/visible/);
        });

        test('the Start button starts the game', async ({ page }) => {
            await page.locator('#btn-start').click();
            expect(await page.evaluate(() => state)).toBe('running');
        });

        test('wave 1 spawns landers and a full complement of humanoids', async ({ page }) => {
            const s = await page.evaluate(() => {
                startGame();
                return {
                    landers: landers.length,
                    humans: humanoids.length,
                    onGround: humanoids.filter((h) => h.state === 'ground').length,
                    wave, lives, smartBombs, score,
                };
            });
            expect(s.landers).toBeGreaterThan(0);
            expect(s.humans).toBe(10);
            expect(s.onGround).toBe(10);
            expect(s).toMatchObject({ wave: 1, lives: 3, smartBombs: 3, score: 0 });
        });

        test('the player starts alive, inside the world and above the ground', async ({ page }) => {
            const ok = await page.evaluate(() => {
                startGame();
                return player.x >= 0 && player.x < WORLD_W
                    && player.y > PLAY_TOP && player.y < groundY(player.x);
            });
            expect(ok).toBe(true);
        });

        test('humanoids stand on the terrain', async ({ page }) => {
            const ok = await page.evaluate(() => {
                startGame();
                return humanoids.every((h) => Math.abs(h.y - groundY(h.x)) < 2);
            });
            expect(ok).toBe(true);
        });

        test('restarting from game over resets the score and lives', async ({ page }) => {
            const s = await page.evaluate(() => {
                startGame();
                score = 900; lives = 0; state = 'gameover';
                startGame();
                return { score, lives, state, wave };
            });
            expect(s).toEqual({ score: 0, lives: 3, state: 'running', wave: 1 });
        });
    });

    // -----------------------------------------------------------------------
    // Flying
    // -----------------------------------------------------------------------
    test.describe('flying', () => {
        test('holding right accelerates the ship to the right', async ({ page }) => {
            const moved = await page.evaluate(([stepSrc]) => {
                const step = eval(stepSrc);
                startGame();
                player.x = 1000; player.vx = 0;
                input.right = true;
                step(30, 1 / 60);
                return { x: player.x, vx: player.vx, dir: player.dir };
            }, [STEP]);
            expect(moved.vx).toBeGreaterThan(0);
            expect(moved.x).toBeGreaterThan(1000);
            expect(moved.dir).toBe(1);
        });

        test('holding left flips the ship and moves it left', async ({ page }) => {
            const moved = await page.evaluate(([stepSrc]) => {
                const step = eval(stepSrc);
                startGame();
                player.x = 1000; player.vx = 0;
                input.left = true;
                step(30, 1 / 60);
                return { x: player.x, dir: player.dir };
            }, [STEP]);
            expect(moved.x).toBeLessThan(1000);
            expect(moved.dir).toBe(-1);
        });

        test('horizontal speed is capped', async ({ page }) => {
            const vx = await page.evaluate(([stepSrc]) => {
                const step = eval(stepSrc);
                startGame();
                input.right = true;
                step(600, 1 / 60);
                return player.vx;
            }, [STEP]);
            expect(vx).toBeLessThanOrEqual(await page.evaluate(() => MAX_VX + 0.001));
        });

        test('thrusting up moves the ship up, thrusting down moves it down', async ({ page }) => {
            const s = await page.evaluate(([stepSrc]) => {
                const step = eval(stepSrc);
                startGame();
                player.y = 250; input.up = true;
                step(20, 1 / 60);
                const up = player.y;
                input.up = false; player.vy = 0; player.y = 250; input.down = true;
                step(20, 1 / 60);
                return { up, down: player.y };
            }, [STEP]);
            expect(s.up).toBeLessThan(250);
            expect(s.down).toBeGreaterThan(250);
        });

        test('the ship cannot fly above the scanner or into the ground', async ({ page }) => {
            const s = await page.evaluate(([stepSrc]) => {
                const step = eval(stepSrc);
                startGame();
                input.up = true; step(400, 1 / 60);
                const top = player.y;
                input.up = false; input.down = true; step(400, 1 / 60);
                return { top, bottom: player.y, floor: groundY(player.x), ceiling: PLAY_TOP };
            }, [STEP]);
            expect(s.top).toBeGreaterThanOrEqual(s.ceiling);
            expect(s.bottom).toBeLessThanOrEqual(s.floor);
        });

        test('flying past the world edge wraps around', async ({ page }) => {
            const x = await page.evaluate(([stepSrc]) => {
                const step = eval(stepSrc);
                startGame();
                player.x = WORLD_W - 20; player.vx = MAX_VX; input.right = true;
                step(60, 1 / 60);
                return player.x;
            }, [STEP]);
            expect(x).toBeGreaterThanOrEqual(0);
            expect(x).toBeLessThan(3200);
        });

        test('arrow keys drive the input flags', async ({ page }) => {
            await page.evaluate(() => startGame());
            await page.keyboard.down('ArrowRight');
            expect(await page.evaluate(() => input.right)).toBe(true);
            await page.keyboard.up('ArrowRight');
            expect(await page.evaluate(() => input.right)).toBe(false);
            await page.keyboard.down('ArrowUp');
            expect(await page.evaluate(() => input.up)).toBe(true);
            await page.keyboard.up('ArrowUp');
            expect(await page.evaluate(() => input.up)).toBe(false);
        });

        test('the camera keeps the ship on screen', async ({ page }) => {
            const ok = await page.evaluate(([stepSrc]) => {
                const step = eval(stepSrc);
                startGame();
                input.right = true;
                for (let i = 0; i < 20; i++) {
                    step(20, 1 / 60);
                    const sx = wrapDelta(cameraX, player.x);
                    if (sx < 0 || sx > CANVAS_W) return false;
                }
                return true;
            }, [STEP]);
            expect(ok).toBe(true);
        });
    });

    // -----------------------------------------------------------------------
    // Shooting
    // -----------------------------------------------------------------------
    test.describe('shooting', () => {
        test('firing spawns a bullet travelling in the ship facing', async ({ page }) => {
            const s = await page.evaluate(() => {
                startGame();
                bullets.length = 0;
                player.dir = 1; fire();
                const right = bullets[0].vx;
                bullets.length = 0;
                player.dir = -1; fire();
                return { right, left: bullets[0].vx, count: bullets.length };
            });
            expect(s.right).toBeGreaterThan(0);
            expect(s.left).toBeLessThan(0);
            expect(s.count).toBe(1);
        });

        test('the number of live bullets is capped', async ({ page }) => {
            const n = await page.evaluate(() => {
                startGame();
                bullets.length = 0;
                for (let i = 0; i < 50; i++) fire();
                return bullets.length;
            });
            expect(n).toBeLessThanOrEqual(await page.evaluate(() => MAX_BULLETS));
        });

        test('bullets expire after their lifetime', async ({ page }) => {
            const n = await page.evaluate(([stepSrc]) => {
                const step = eval(stepSrc);
                startGame();
                landers.length = 0; mutants.length = 0;
                bullets.length = 0; fire();
                step(120, 1 / 60);
                return bullets.length;
            }, [STEP]);
            expect(n).toBe(0);
        });

        test('a bullet destroys a lander and scores points', async ({ page }) => {
            const s = await page.evaluate(([stepSrc]) => {
                const step = eval(stepSrc);
                startGame();
                landers.length = 0; mutants.length = 0; bullets.length = 0; score = 0;
                player.x = 1000; player.y = 200; player.dir = 1;
                landers.push(makeLander(wrapX(1120), 200));
                fire();
                step(20, 1 / 60);
                return { landers: landers.length, score, bullets: bullets.length };
            }, [STEP]);
            expect(s.landers).toBe(0);
            expect(s.score).toBe(150);
            expect(s.bullets).toBe(0);
        });

        test('a bullet destroys a mutant and scores points', async ({ page }) => {
            const s = await page.evaluate(([stepSrc]) => {
                const step = eval(stepSrc);
                startGame();
                landers.length = 0; mutants.length = 0; bullets.length = 0; score = 0;
                player.x = 1000; player.y = 200; player.dir = 1;
                mutants.push(makeMutant(wrapX(1120), 200));
                fire();
                step(20, 1 / 60);
                return { mutants: mutants.length, score };
            }, [STEP]);
            expect(s.mutants).toBe(0);
            expect(s.score).toBe(150);
        });

        test('bullets miss enemies that are not in their path', async ({ page }) => {
            const n = await page.evaluate(([stepSrc]) => {
                const step = eval(stepSrc);
                startGame();
                landers.length = 0; mutants.length = 0; bullets.length = 0;
                player.x = 1000; player.y = 200; player.dir = 1;
                landers.push(makeLander(wrapX(1120), 340));
                fire();
                step(20, 1 / 60);
                return landers.length;
            }, [STEP]);
            expect(n).toBe(1);
        });

        test('firing does nothing while idle', async ({ page }) => {
            const n = await page.evaluate(() => { fire(); return bullets.length; });
            expect(n).toBe(0);
        });
    });

    // -----------------------------------------------------------------------
    // Landers & abduction
    // -----------------------------------------------------------------------
    test.describe('landers', () => {
        test('a hunting lander descends toward a humanoid', async ({ page }) => {
            const s = await page.evaluate(([stepSrc]) => {
                const step = eval(stepSrc);
                startGame();
                landers.length = 0; mutants.length = 0;
                const h = humanoids[0];
                h.state = 'ground';
                const l = makeLander(h.x, PLAY_TOP + 20);
                landers.push(l);
                const y0 = l.y;
                const d0 = Math.abs(wrapDelta(l.x, h.x));
                step(60, 1 / 60);
                return { y0, y1: l.y, d0, d1: Math.abs(wrapDelta(l.x, h.x)) };
            }, [STEP]);
            expect(s.y1).toBeGreaterThan(s.y0);
            expect(s.d1).toBeLessThanOrEqual(s.d0);
        });

        test('a lander that reaches a humanoid picks it up and climbs', async ({ page }) => {
            const s = await page.evaluate(([stepSrc]) => {
                const step = eval(stepSrc);
                startGame();
                landers.length = 0; mutants.length = 0;
                const h = humanoids[0];
                const l = makeLander(h.x, h.y - 30);
                landers.push(l);
                step(60, 1 / 60);
                const grabbed = { lander: l.state, human: h.state, y: l.y };
                step(120, 1 / 60);
                return { ...grabbed, climbed: l.y < grabbed.y, humanFollows: Math.abs(h.y - (l.y + LANDER_R + 8)) < 2 };
            }, [STEP]);
            expect(s.lander).toBe('carrying');
            expect(s.human).toBe('abducted');
            expect(s.climbed).toBe(true);
            expect(s.humanFollows).toBe(true);
        });

        test('a lander that carries a humanoid to the top becomes a mutant', async ({ page }) => {
            const s = await page.evaluate(([stepSrc]) => {
                const step = eval(stepSrc);
                startGame();
                landers.length = 0; mutants.length = 0;
                const h = humanoids[0];
                const l = makeLander(h.x, h.y - 30);
                landers.push(l);
                step(600, 1 / 60);
                return {
                    landers: landers.length,
                    mutants: mutants.length,
                    humans: humanoids.length,
                    hasHuman: humanoids.includes(h),
                };
            }, [STEP]);
            expect(s.landers).toBe(0);
            expect(s.mutants).toBe(1);
            expect(s.hasHuman).toBe(false);
            expect(s.humans).toBe(9);
        });

        test('shooting a carrying lander drops the humanoid', async ({ page }) => {
            const s = await page.evaluate(([stepSrc]) => {
                const step = eval(stepSrc);
                startGame();
                landers.length = 0; mutants.length = 0; bullets.length = 0;
                const h = humanoids[0];
                const l = makeLander(h.x, h.y - 30);
                landers.push(l);
                step(90, 1 / 60);
                const carrying = l.state === 'carrying';
                killLander(l);
                return { carrying, human: h.state, landers: landers.length };
            }, [STEP]);
            expect(s.carrying).toBe(true);
            expect(s.human).toBe('falling');
            expect(s.landers).toBe(0);
        });

        test('mutants chase the player', async ({ page }) => {
            const closer = await page.evaluate(([stepSrc]) => {
                const step = eval(stepSrc);
                startGame();
                landers.length = 0; mutants.length = 0;
                player.x = 1600; player.y = 200; player.invuln = 999;
                const m = makeMutant(wrapX(1900), 400);
                mutants.push(m);
                const d0 = Math.hypot(wrapDelta(m.x, player.x), m.y - player.y);
                step(60, 1 / 60);
                const d1 = Math.hypot(wrapDelta(m.x, player.x), m.y - player.y);
                return d1 < d0;
            }, [STEP]);
            expect(closer).toBe(true);
        });

        test('landers shoot at the player', async ({ page }) => {
            const n = await page.evaluate(([stepSrc]) => {
                const step = eval(stepSrc);
                startGame();
                mutants.length = 0; enemyBullets.length = 0;
                landers.length = 0;
                for (let i = 0; i < 6; i++) landers.push(makeLander(wrapX(player.x + 60 + i * 20), 200));
                player.invuln = 9999;
                step(360, 1 / 60);
                return enemyBullets.length;
            }, [STEP]);
            expect(n).toBeGreaterThan(0);
        });
    });

    // -----------------------------------------------------------------------
    // Rescuing humanoids
    // -----------------------------------------------------------------------
    test.describe('rescues', () => {
        test('flying into a falling humanoid catches it', async ({ page }) => {
            const s = await page.evaluate(([stepSrc]) => {
                const step = eval(stepSrc);
                startGame();
                landers.length = 0; mutants.length = 0;
                const h = humanoids[0];
                player.x = h.x; player.y = 200;
                h.state = 'falling'; h.x = player.x; h.y = 204; h.vy = 0;
                step(3, 1 / 60);
                return { state: h.state, carried: player.carrying === h };
            }, [STEP]);
            expect(s.state).toBe('carried');
            expect(s.carried).toBe(true);
        });

        test('a carried humanoid follows the ship', async ({ page }) => {
            const near = await page.evaluate(([stepSrc]) => {
                const step = eval(stepSrc);
                startGame();
                landers.length = 0; mutants.length = 0;
                const h = humanoids[0];
                player.x = h.x; player.y = 200;
                h.state = 'carried'; player.carrying = h;
                input.right = true;
                step(30, 1 / 60);
                return Math.abs(wrapDelta(h.x, player.x)) < 4 && h.y > player.y;
            }, [STEP]);
            expect(near).toBe(true);
        });

        test('landing a carried humanoid scores a rescue', async ({ page }) => {
            const s = await page.evaluate(([stepSrc]) => {
                const step = eval(stepSrc);
                startGame();
                landers.length = 0; mutants.length = 0; score = 0;
                const h = humanoids[0];
                player.x = h.x; player.y = groundY(h.x) - 60;
                h.state = 'carried'; player.carrying = h;
                input.down = true;
                step(120, 1 / 60);
                return { state: h.state, score, carrying: player.carrying, onGround: Math.abs(h.y - groundY(h.x)) < 2 };
            }, [STEP]);
            expect(s.state).toBe('ground');
            expect(s.score).toBe(500);
            expect(s.carrying).toBe(null);
            expect(s.onGround).toBe(true);
        });

        test('a humanoid dropped from high up dies on impact', async ({ page }) => {
            const s = await page.evaluate(([stepSrc]) => {
                const step = eval(stepSrc);
                startGame();
                landers.length = 0; mutants.length = 0;
                player.x = 100; player.y = 400;   // keep the ship away from the fall
                const h = humanoids[0];
                h.x = wrapX(2000); h.state = 'falling'; h.y = PLAY_TOP + 20; h.vy = 0;
                step(200, 1 / 60);   // long enough to fall, short enough that the
                                     // next wave cannot complete an abduction
                return { alive: humanoids.includes(h), count: humanoids.length };
            }, [STEP]);
            expect(s.alive).toBe(false);
            expect(s.count).toBe(9);
        });

        test('a humanoid dropped from just above the ground survives', async ({ page }) => {
            const s = await page.evaluate(([stepSrc]) => {
                const step = eval(stepSrc);
                startGame();
                landers.length = 0; mutants.length = 0;
                player.x = 100; player.y = 400;
                const h = humanoids[1];
                h.state = 'falling'; h.y = groundY(h.x) - 30; h.vy = 0;
                step(120, 1 / 60);
                return { state: h.state, alive: humanoids.includes(h) };
            }, [STEP]);
            expect(s.alive).toBe(true);
            expect(s.state).toBe('ground');
        });
    });

    // -----------------------------------------------------------------------
    // Smart bombs & hyperspace
    // -----------------------------------------------------------------------
    test.describe('smart bombs and hyperspace', () => {
        test('a smart bomb clears on-screen enemies and costs a bomb', async ({ page }) => {
            const s = await page.evaluate(() => {
                startGame();
                landers.length = 0; mutants.length = 0; score = 0;
                player.x = 1000;
                landers.push(makeLander(wrapX(1050), 200));
                mutants.push(makeMutant(wrapX(950), 250));
                const before = smartBombs;
                useSmartBomb();
                return { landers: landers.length, mutants: mutants.length, before, after: smartBombs, score };
            });
            expect(s.landers).toBe(0);
            expect(s.mutants).toBe(0);
            expect(s.after).toBe(s.before - 1);
            expect(s.score).toBe(300);
        });

        test('a smart bomb spares enemies far across the world', async ({ page }) => {
            const n = await page.evaluate(() => {
                startGame();
                landers.length = 0; mutants.length = 0;
                player.x = 200;
                landers.push(makeLander(wrapX(1800), 200));
                useSmartBomb();
                return landers.length;
            });
            expect(n).toBe(1);
        });

        test('smart bombs cannot be used when the stock is empty', async ({ page }) => {
            const s = await page.evaluate(() => {
                startGame();
                landers.length = 0; mutants.length = 0;
                smartBombs = 0;
                landers.push(makeLander(player.x, 200));
                useSmartBomb();
                return { landers: landers.length, smartBombs };
            });
            expect(s.landers).toBe(1);
            expect(s.smartBombs).toBe(0);
        });

        test('hyperspace teleports the ship somewhere else', async ({ page }) => {
            const s = await page.evaluate(() => {
                startGame();
                const x0 = player.x;
                hyperspace();
                return { moved: Math.abs(wrapDelta(x0, player.x)) > 100, inWorld: player.x >= 0 && player.x < WORLD_W, safe: player.y < groundY(player.x) };
            });
            expect(s).toEqual({ moved: true, inWorld: true, safe: true });
        });

        test('hyperspace has a cooldown', async ({ page }) => {
            const same = await page.evaluate(() => {
                startGame();
                hyperspace();
                const x = player.x;
                hyperspace();
                return player.x === x;
            });
            expect(same).toBe(true);
        });

        test('the B and H keys trigger bomb and hyperspace', async ({ page }) => {
            await page.evaluate(() => { startGame(); landers.length = 0; mutants.length = 0; });
            await page.keyboard.press('KeyB');
            expect(await page.evaluate(() => smartBombs)).toBe(2);
            const x0 = await page.evaluate(() => player.x);
            await page.keyboard.press('KeyH');
            expect(await page.evaluate(() => player.x)).not.toBe(x0);
        });
    });

    // -----------------------------------------------------------------------
    // Damage, lives and game over
    // -----------------------------------------------------------------------
    test.describe('damage', () => {
        test('colliding with a lander costs a life', async ({ page }) => {
            const s = await page.evaluate(([stepSrc]) => {
                const step = eval(stepSrc);
                startGame();
                landers.length = 0; mutants.length = 0;
                player.invuln = 0; player.x = 1000; player.y = 200;
                landers.push(makeLander(player.x, player.y));
                step(2, 1 / 60);
                return { lives, invuln: player.invuln > 0 };
            }, [STEP]);
            expect(s.lives).toBe(2);
            expect(s.invuln).toBe(true);
        });

        test('an enemy bullet costs a life', async ({ page }) => {
            const s = await page.evaluate(([stepSrc]) => {
                const step = eval(stepSrc);
                startGame();
                landers.length = 0; mutants.length = 0; enemyBullets.length = 0;
                player.invuln = 0; player.x = 1000; player.y = 200;
                enemyBullets.push({ x: player.x, y: player.y, vx: 0, vy: 0, life: 3 });
                step(2, 1 / 60);
                return { lives, bullets: enemyBullets.length };
            }, [STEP]);
            expect(s.lives).toBe(2);
            expect(s.bullets).toBe(0);
        });

        test('the ship is invulnerable right after respawning', async ({ page }) => {
            const lives = await page.evaluate(([stepSrc]) => {
                const step = eval(stepSrc);
                startGame();
                landers.length = 0; mutants.length = 0;
                player.invuln = 0; player.x = 1000; player.y = 200;
                landers.push(makeLander(player.x, player.y));
                landers.push(makeLander(player.x, player.y));
                step(30, 1 / 60);
                return lives;
            }, [STEP]);
            expect(lives).toBe(2);
        });

        test('a carried humanoid is released when the ship dies', async ({ page }) => {
            const s = await page.evaluate(() => {
                startGame();
                const h = humanoids[0];
                h.state = 'carried'; player.carrying = h;
                killPlayer();
                return { state: h.state, carrying: player.carrying };
            });
            expect(s.state).toBe('falling');
            expect(s.carrying).toBe(null);
        });

        test('losing the last life ends the game and shows the overlay', async ({ page }) => {
            await page.evaluate(() => {
                startGame();
                lives = 1;
                killPlayer();
            });
            expect(await page.evaluate(() => state)).toBe('gameover');
            await expect(page.locator('#overlay')).toHaveClass(/visible/);
            await expect(page.locator('#overlay-title')).toContainText(/game over/i);
        });

        test('the best score is persisted on game over', async ({ page }) => {
            const stored = await page.evaluate(() => {
                startGame();
                score = 7350; lives = 1;
                killPlayer();
                return window.localStorage.getItem('defender-best');
            });
            expect(stored).toBe('7350');
            await expect(page.locator('#best')).toHaveText('7350');
        });
    });

    // -----------------------------------------------------------------------
    // Waves
    // -----------------------------------------------------------------------
    test.describe('waves', () => {
        test('clearing every enemy advances the wave', async ({ page }) => {
            const s = await page.evaluate(([stepSrc]) => {
                const step = eval(stepSrc);
                startGame();
                const before = landers.length;
                landers.length = 0; mutants.length = 0;
                step(180, 1 / 60);
                return { wave, landers: landers.length, before };
            }, [STEP]);
            expect(s.wave).toBe(2);
            expect(s.landers).toBeGreaterThanOrEqual(s.before);
        });

        test('later waves send more landers', async ({ page }) => {
            const s = await page.evaluate(() => {
                startGame();
                const a = landerCountForWave(1);
                const b = landerCountForWave(5);
                return { a, b };
            });
            expect(s.b).toBeGreaterThan(s.a);
        });

        test('a cleared wave pays a bonus for surviving humanoids', async ({ page }) => {
            const s = await page.evaluate(([stepSrc]) => {
                const step = eval(stepSrc);
                startGame();
                landers.length = 0; mutants.length = 0;
                score = 0;
                const humans = humanoids.length;
                step(180, 1 / 60);
                return { score, humans };
            }, [STEP]);
            expect(s.score).toBe(s.humans * 100);
        });

        test('surviving humanoids carry over into the next wave', async ({ page }) => {
            const s = await page.evaluate(([stepSrc]) => {
                const step = eval(stepSrc);
                startGame();
                humanoids.splice(0, 4);
                landers.length = 0; mutants.length = 0;
                step(180, 1 / 60);
                return humanoids.length;
            }, [STEP]);
            expect(s).toBe(6);
        });

        test('losing every humanoid turns the remaining landers into mutants', async ({ page }) => {
            const s = await page.evaluate(([stepSrc]) => {
                const step = eval(stepSrc);
                startGame();
                landers.length = 0; mutants.length = 0;
                landers.push(makeLander(1000, 200), makeLander(1200, 220));
                humanoids.length = 0;
                step(5, 1 / 60);
                return { landers: landers.length, mutants: mutants.length };
            }, [STEP]);
            expect(s.landers).toBe(0);
            expect(s.mutants).toBe(2);
        });
    });

    // -----------------------------------------------------------------------
    // Pause & HUD
    // -----------------------------------------------------------------------
    test.describe('pause and HUD', () => {
        test('P pauses and resumes', async ({ page }) => {
            await page.keyboard.press('Space');
            await page.keyboard.press('KeyP');
            expect(await page.evaluate(() => state)).toBe('paused');
            await expect(page.locator('#overlay')).toHaveClass(/visible/);
            await page.keyboard.press('KeyP');
            expect(await page.evaluate(() => state)).toBe('running');
        });

        test('the simulation is frozen while paused', async ({ page }) => {
            const same = await page.evaluate(([stepSrc]) => {
                const step = eval(stepSrc);
                startGame();
                player.vx = 200;
                const x = player.x;
                togglePause();
                step(60, 1 / 60);
                return player.x === x;
            }, [STEP]);
            expect(same).toBe(true);
        });

        test('the HUD reflects the live game state', async ({ page }) => {
            await page.evaluate(() => {
                startGame();
                score = 1234; lives = 2; smartBombs = 1; wave = 3;
                humanoids.length = 7;
                updateHud();
            });
            await expect(page.locator('#score')).toHaveText('1234');
            await expect(page.locator('#lives')).toHaveText('2');
            await expect(page.locator('#bombs')).toHaveText('1');
            await expect(page.locator('#wave')).toHaveText('3');
            await expect(page.locator('#humans')).toHaveText('7');
        });

        test('a long unattended game stays consistent', async ({ page }) => {
            const errors = [];
            page.on('pageerror', (e) => errors.push(String(e)));
            const report = await page.evaluate(() => {
                startGame();
                lives = 99;                       // survive long enough to see many waves
                const finite = (v) => Number.isFinite(v);
                let bad = null;
                for (let i = 0; i < 9000; i++) {  // ~2.5 minutes of play
                    input.right = i % 240 < 120;
                    input.left = !input.right;
                    input.up = i % 130 < 60;
                    input.down = !input.up;
                    if (i % 20 === 0) fire();
                    if (i % 900 === 0) useSmartBomb();
                    update(1 / 60);
                    draw();
                    const all = [...landers, ...mutants, ...humanoids, ...bullets, ...enemyBullets];
                    for (const e of all) {
                        if (!finite(e.x) || !finite(e.y) || e.x < 0 || e.x >= WORLD_W) { bad = { i, e }; break; }
                    }
                    if (bad) break;
                    if (humanoids.length > 10) { bad = { i, humans: humanoids.length }; break; }
                    if (!finite(player.x) || !finite(player.y) || player.y < PLAY_TOP - 1) { bad = { i, player: { ...player } }; break; }
                }
                return { bad, wave, state, humans: humanoids.length };
            });
            expect(errors).toEqual([]);
            expect(report.bad).toBe(null);
            expect(report.state).toBe('running');
            expect(report.wave).toBeGreaterThan(1);
        });

        test('the canvas is actually painted', async ({ page }) => {
            const painted = await page.evaluate(() => {
                startGame();
                draw();
                const data = canvas.getContext('2d').getImageData(0, 0, CANVAS_W, CANVAS_H).data;
                for (let i = 0; i < data.length; i += 4) {
                    if (data[i] || data[i + 1] || data[i + 2]) return true;
                }
                return false;
            });
            expect(painted).toBe(true);
        });
    });
});
