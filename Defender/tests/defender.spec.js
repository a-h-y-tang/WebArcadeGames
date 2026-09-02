const { test, expect } = require('@playwright/test');
const path = require('path');
const { pathToFileURL } = require('url');

const GAME_URL = pathToFileURL(path.resolve(__dirname, '../index.html')).href;

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

        test('start overlay is visible and prompts the player', async ({ page }) => {
            await expect(page.locator('#overlay')).toHaveClass(/visible/);
            await expect(page.locator('#overlay-sub')).toContainText(/space|start/i);
        });

        test('canvas is 800x420', async ({ page }) => {
            const canvas = page.locator('#canvas');
            await expect(canvas).toHaveAttribute('width', '800');
            await expect(canvas).toHaveAttribute('height', '420');
        });

        test('the HUD starts at zero score with full lives and bombs', async ({ page }) => {
            const { lives, bombs } = await page.evaluate(() => ({ lives: START_LIVES, bombs: START_BOMBS }));
            await expect(page.locator('#score')).toHaveText('0');
            await expect(page.locator('#lives')).toHaveText(String(lives));
            await expect(page.locator('#bombs')).toHaveText(String(bombs));
            await expect(page.locator('#wave')).toHaveText('1');
        });

        test('state is idle before starting', async ({ page }) => {
            expect(await page.evaluate(() => state)).toBe('idle');
        });

        test('stepping while idle does nothing', async ({ page }) => {
            const moved = await page.evaluate(() => {
                const before = { x: ship.x, y: ship.y };
                for (let i = 0; i < 30; i++) step(0.016);
                return ship.x !== before.x || ship.y !== before.y;
            });
            expect(moved).toBe(false);
        });

        test('the world is wider than the canvas', async ({ page }) => {
            const { world, view } = await page.evaluate(() => ({ world: WORLD_W, view: CANVAS_W }));
            expect(world).toBeGreaterThan(view);
        });

        test('the high score loads from localStorage', async ({ page }) => {
            await page.evaluate(() => window.localStorage.setItem('defender-highscore', '4200'));
            await page.reload();
            await expect(page.locator('#high')).toHaveText('4200');
        });
    });

    // -----------------------------------------------------------------------
    // World geometry
    // -----------------------------------------------------------------------
    test.describe('world geometry', () => {
        test('wrapX keeps coordinates inside the world', async ({ page }) => {
            const values = await page.evaluate(() =>
                [-10, 0, WORLD_W - 1, WORLD_W, WORLD_W + 25, WORLD_W * 3 + 7].map(wrapX));
            for (const v of values) {
                expect(v).toBeGreaterThanOrEqual(0);
                expect(v).toBeLessThan(await page.evaluate(() => WORLD_W));
            }
        });

        test('worldDelta takes the short way around the seam', async ({ page }) => {
            const d = await page.evaluate(() => worldDelta(10, WORLD_W - 10));
            expect(d).toBe(-20);
        });

        test('worldDelta is signed toward the target', async ({ page }) => {
            const d = await page.evaluate(() => worldDelta(100, 260));
            expect(d).toBe(160);
        });

        test('worldDelta never exceeds half the world', async ({ page }) => {
            const ok = await page.evaluate(() => {
                for (let a = 0; a < WORLD_W; a += 37) {
                    for (let b = 0; b < WORLD_W; b += 53) {
                        if (Math.abs(worldDelta(a, b)) > WORLD_W / 2 + 0.001) return false;
                    }
                }
                return true;
            });
            expect(ok).toBe(true);
        });

        test('the terrain is continuous across the seam', async ({ page }) => {
            const { start, end } = await page.evaluate(() => ({
                start: terrainAt(0), end: terrainAt(WORLD_W - 0.001),
            }));
            expect(Math.abs(start - end)).toBeLessThan(1);
        });

        test('the terrain stays inside the play area', async ({ page }) => {
            const ok = await page.evaluate(() => {
                for (let x = 0; x < WORLD_W; x += 3) {
                    const y = terrainAt(x);
                    if (y <= PLAY_TOP || y > CANVAS_H) return false;
                }
                return true;
            });
            expect(ok).toBe(true);
        });

        test('the terrain is identical on every load', async ({ page }) => {
            const first = await page.evaluate(() => [0, 300, 900, 1700].map(terrainAt));
            await page.reload();
            const second = await page.evaluate(() => [0, 300, 900, 1700].map(terrainAt));
            expect(second).toEqual(first);
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

        test('the Start button starts the game', async ({ page }) => {
            await page.locator('#btn-start').click();
            expect(await page.evaluate(() => state)).toBe('running');
        });

        test('a fresh game resets score, lives, wave and bombs', async ({ page }) => {
            const s = await page.evaluate(() => {
                score = 999; lives = 1; wave = 6; bombs = 0;
                startGame();
                return { score, lives, wave, bombs, startLives: START_LIVES, startBombs: START_BOMBS };
            });
            expect(s.score).toBe(0);
            expect(s.wave).toBe(1);
            expect(s.lives).toBe(s.startLives);
            expect(s.bombs).toBe(s.startBombs);
        });

        test('a fresh game populates the planet with humanoids', async ({ page }) => {
            const s = await page.evaluate(() => {
                startGame();
                return { count: humans.length, allGround: humans.every((h) => h.state === 'ground') };
            });
            expect(s.count).toBe(await page.evaluate(() => HUMAN_COUNT));
            expect(s.allGround).toBe(true);
        });

        test('humanoids start standing on the terrain', async ({ page }) => {
            const ok = await page.evaluate(() => {
                startGame();
                return humans.every((h) => Math.abs(h.y - terrainAt(h.x)) < 2);
            });
            expect(ok).toBe(true);
        });

        test('wave 1 spawns landers', async ({ page }) => {
            const n = await page.evaluate(() => { startGame(); return landers.length; });
            expect(n).toBeGreaterThan(0);
        });

        test('the ship starts alive, centred and stationary', async ({ page }) => {
            const s = await page.evaluate(() => {
                startGame();
                return { x: ship.x, vx: ship.vx, dir: ship.dir, y: ship.y };
            });
            expect(s.vx).toBe(0);
            expect(s.dir).toBe(1);
            expect(s.y).toBeGreaterThan(await page.evaluate(() => PLAY_TOP));
        });
    });

    // -----------------------------------------------------------------------
    // Ship movement
    // -----------------------------------------------------------------------
    test.describe('ship movement', () => {
        test('thrusting right increases x', async ({ page }) => {
            const moved = await page.evaluate(() => {
                startGame();
                const before = ship.x;
                setThrust(1);
                for (let i = 0; i < 20; i++) step(0.016);
                return worldDelta(before, ship.x);
            });
            expect(moved).toBeGreaterThan(0);
        });

        test('thrusting left decreases x and flips the ship', async ({ page }) => {
            const s = await page.evaluate(() => {
                startGame();
                const before = ship.x;
                setThrust(-1);
                for (let i = 0; i < 20; i++) step(0.016);
                return { moved: worldDelta(before, ship.x), dir: ship.dir };
            });
            expect(s.moved).toBeLessThan(0);
            expect(s.dir).toBe(-1);
        });

        test('the ship coasts to a stop when thrust is released', async ({ page }) => {
            const vx = await page.evaluate(() => {
                startGame();
                setThrust(1);
                for (let i = 0; i < 30; i++) step(0.016);
                setThrust(0);
                for (let i = 0; i < 300; i++) step(0.016);
                return Math.abs(ship.vx);
            });
            expect(vx).toBeLessThan(1);
        });

        test('the ship speed is capped', async ({ page }) => {
            const s = await page.evaluate(() => {
                startGame();
                setThrust(1);
                for (let i = 0; i < 600; i++) step(0.016);
                return { vx: Math.abs(ship.vx), cap: SHIP_MAX_SPEED };
            });
            expect(s.vx).toBeLessThanOrEqual(s.cap + 0.001);
        });

        test('climbing decreases y and diving increases it', async ({ page }) => {
            const s = await page.evaluate(() => {
                startGame();
                ship.y = 250;
                setClimb(-1);
                for (let i = 0; i < 10; i++) step(0.016);
                const up = ship.y;
                setClimb(1);
                for (let i = 0; i < 20; i++) step(0.016);
                return { up, down: ship.y };
            });
            expect(s.up).toBeLessThan(250);
            expect(s.down).toBeGreaterThan(s.up);
        });

        test('the ship cannot climb into the radar strip', async ({ page }) => {
            const s = await page.evaluate(() => {
                startGame();
                setClimb(-1);
                for (let i = 0; i < 400; i++) step(0.016);
                return { y: ship.y, top: PLAY_TOP };
            });
            expect(s.y).toBeGreaterThanOrEqual(s.top);
        });

        test('the ship cannot fly through the ground', async ({ page }) => {
            const ok = await page.evaluate(() => {
                startGame();
                setClimb(1);
                setThrust(1);
                for (let i = 0; i < 400; i++) {
                    step(0.016);
                    if (ship.y > terrainAt(ship.x) + 0.5) return false;
                }
                return true;
            });
            expect(ok).toBe(true);
        });

        test('the ship wraps around the world', async ({ page }) => {
            const s = await page.evaluate(() => {
                startGame();
                ship.x = WORLD_W - 5;
                ship.vx = SHIP_MAX_SPEED;
                setThrust(1);
                for (let i = 0; i < 20; i++) step(0.016);
                return { x: ship.x, world: WORLD_W };
            });
            expect(s.x).toBeGreaterThanOrEqual(0);
            expect(s.x).toBeLessThan(s.world);
        });

        test('arrow keys drive the ship', async ({ page }) => {
            await page.evaluate(() => startGame());
            const before = await page.evaluate(() => ship.x);
            await page.keyboard.down('ArrowLeft');
            await page.evaluate(() => { for (let i = 0; i < 20; i++) step(0.016); });
            await page.keyboard.up('ArrowLeft');
            const after = await page.evaluate(() => ship.x);
            expect(await page.evaluate(([a, b]) => worldDelta(a, b), [before, after])).toBeLessThan(0);
        });

        test('releasing a key stops the thrust input', async ({ page }) => {
            await page.evaluate(() => startGame());
            await page.keyboard.down('ArrowRight');
            await page.evaluate(() => { for (let i = 0; i < 5; i++) step(0.016); });
            await page.keyboard.up('ArrowRight');
            expect(await page.evaluate(() => ship.thrust)).toBe(0);
        });
    });

    // -----------------------------------------------------------------------
    // The camera
    // -----------------------------------------------------------------------
    test.describe('camera', () => {
        test('the camera keeps the ship on screen', async ({ page }) => {
            const ok = await page.evaluate(() => {
                startGame();
                setThrust(1);
                for (let i = 0; i < 500; i++) {
                    step(0.016);
                    const sx = screenX(ship.x);
                    if (sx < 0 || sx > CANVAS_W) return false;
                }
                return true;
            });
            expect(ok).toBe(true);
        });

        test('screenX maps across the seam without a jump', async ({ page }) => {
            const ok = await page.evaluate(() => {
                camX = WORLD_W - 100;
                const a = screenX(wrapX(WORLD_W - 10));
                const b = screenX(wrapX(10));
                return b > a && b - a < 40;
            });
            expect(ok).toBe(true);
        });
    });

    // -----------------------------------------------------------------------
    // Firing
    // -----------------------------------------------------------------------
    test.describe('firing', () => {
        test('firing creates a bullet', async ({ page }) => {
            const n = await page.evaluate(() => { startGame(); fire(); return bullets.length; });
            expect(n).toBe(1);
        });

        test('a bullet travels in the direction the ship faces', async ({ page }) => {
            const s = await page.evaluate(() => {
                startGame();
                ship.dir = -1;
                fire();
                return bullets[0].vx;
            });
            expect(s).toBeLessThan(0);
        });

        test('bullets move each step', async ({ page }) => {
            const moved = await page.evaluate(() => {
                startGame();
                fire();
                const before = bullets[0].x;
                for (let i = 0; i < 3; i++) step(0.016);
                return worldDelta(before, bullets[0].x);
            });
            expect(moved).toBeGreaterThan(0);
        });

        test('only MAX_BULLETS can be alive at once', async ({ page }) => {
            const s = await page.evaluate(() => {
                startGame();
                for (let i = 0; i < 20; i++) fire();
                return { n: bullets.length, cap: MAX_BULLETS };
            });
            expect(s.n).toBe(s.cap);
        });

        test('bullets expire so they cannot orbit the planet forever', async ({ page }) => {
            const n = await page.evaluate(() => {
                startGame();
                landers.length = 0;
                mutants.length = 0;
                fire();
                for (let i = 0; i < 200; i++) step(0.016);
                return bullets.length;
            });
            expect(n).toBe(0);
        });

        test('Space fires while the game is running', async ({ page }) => {
            await page.evaluate(() => startGame());
            await page.keyboard.press('Space');
            expect(await page.evaluate(() => bullets.length)).toBe(1);
        });
    });

    // -----------------------------------------------------------------------
    // Landers
    // -----------------------------------------------------------------------
    test.describe('landers', () => {
        test('a lander descends toward the nearest humanoid', async ({ page }) => {
            const s = await page.evaluate(() => {
                startGame();
                landers.length = 0;
                humans.length = 0;
                humans.push(makeHuman(600));
                const l = spawnLander(640, PLAY_TOP + 30);
                const before = { x: l.x, y: l.y };
                for (let i = 0; i < 30; i++) step(0.016);
                return { dy: l.y - before.y, closer: Math.abs(worldDelta(l.x, 600)) < Math.abs(worldDelta(before.x, 600)) };
            });
            expect(s.dy).toBeGreaterThan(0);
            expect(s.closer).toBe(true);
        });

        test('a lander grabs a humanoid it reaches', async ({ page }) => {
            const s = await page.evaluate(() => {
                startGame();
                landers.length = 0;
                humans.length = 0;
                const h = makeHuman(600);
                humans.push(h);
                spawnLander(600, h.y - 10);
                for (let i = 0; i < 20; i++) step(0.016);
                return { human: h.state, lander: landers[0].state };
            });
            expect(s.human).toBe('grabbed');
            expect(s.lander).toBe('carry');
        });

        test('a carrying lander lifts the humanoid with it', async ({ page }) => {
            const s = await page.evaluate(() => {
                startGame();
                landers.length = 0;
                humans.length = 0;
                const h = makeHuman(600);
                humans.push(h);
                const l = spawnLander(600, h.y - 10);
                for (let i = 0; i < 20; i++) step(0.016);
                const y0 = l.y;
                for (let i = 0; i < 40; i++) step(0.016);
                return { rose: l.y < y0, gap: h.y - l.y, sameX: Math.abs(worldDelta(h.x, l.x)) < 1 };
            });
            expect(s.rose).toBe(true);
            expect(s.gap).toBeGreaterThan(0);
            expect(s.sameX).toBe(true);
        });

        test('a lander that reaches the top becomes a mutant', async ({ page }) => {
            const s = await page.evaluate(() => {
                startGame();
                landers.length = 0;
                mutants.length = 0;
                humans.length = 0;
                const h = makeHuman(600);
                humans.push(h);
                const l = spawnLander(600, MUTATE_Y + 12);
                l.state = 'carry';
                l.human = h;
                h.state = 'grabbed';
                for (let i = 0; i < 60; i++) step(0.016);
                return { landers: landers.length, mutants: mutants.length, humans: humans.length };
            });
            expect(s.landers).toBe(0);
            expect(s.mutants).toBe(1);
            expect(s.humans).toBe(0);
        });

        test('with no humanoids left a lander hunts the ship', async ({ page }) => {
            const s = await page.evaluate(() => {
                startGame();
                landers.length = 0;
                humans.length = 0;
                planetLost = true;                          // the planet already fell
                ship.x = 400;
                ship.y = 300;
                const l = spawnLander(700, PLAY_TOP + 20);
                const before = Math.abs(worldDelta(l.x, ship.x));
                for (let i = 0; i < 30; i++) step(0.016);
                return { before, after: Math.abs(worldDelta(l.x, ship.x)) };
            });
            expect(s.after).toBeLessThan(s.before);
        });

        test('shooting a lander destroys it and scores', async ({ page }) => {
            const s = await page.evaluate(() => {
                startGame();
                landers.length = 0;
                mutants.length = 0;
                score = 0;
                ship.x = 400; ship.y = 250; ship.dir = 1;
                spawnLander(440, 250);
                fire();
                for (let i = 0; i < 20; i++) step(0.016);
                return { n: landers.length, score };
            });
            expect(s.n).toBe(0);
            expect(s.score).toBe(await page.evaluate(() => SCORE_LANDER));
        });

        test('a bullet is consumed by the lander it kills', async ({ page }) => {
            const n = await page.evaluate(() => {
                startGame();
                landers.length = 0;
                ship.x = 400; ship.y = 250; ship.dir = 1;
                spawnLander(440, 250);
                fire();
                for (let i = 0; i < 6; i++) step(0.016);
                return bullets.length;
            });
            expect(n).toBe(0);
        });

        test('landers shoot at the ship when the cooldown expires', async ({ page }) => {
            const n = await page.evaluate(() => {
                startGame();
                mutants.length = 0;
                landers.length = 0;
                enemyBullets.length = 0;
                ship.x = 400; ship.y = 250;
                const l = spawnLander(500, 250);
                l.fireTimer = 0;
                step(0.016);
                return enemyBullets.length;
            });
            expect(n).toBe(1);
        });

        test('an enemy shot travels toward the ship', async ({ page }) => {
            const closer = await page.evaluate(() => {
                startGame();
                landers.length = 0;
                enemyBullets.length = 0;
                ship.x = 400; ship.y = 250;
                const l = spawnLander(600, 250);
                l.fireTimer = 0;
                step(0.016);
                const b = enemyBullets[0];
                const before = Math.abs(worldDelta(b.x, 400));
                for (let i = 0; i < 5; i++) step(0.016);
                return Math.abs(worldDelta(b.x, 400)) < before;
            });
            expect(closer).toBe(true);
        });
    });

    // -----------------------------------------------------------------------
    // Mutants
    // -----------------------------------------------------------------------
    test.describe('mutants', () => {
        test('a mutant closes on the ship', async ({ page }) => {
            const s = await page.evaluate(() => {
                startGame();
                landers.length = 0;
                mutants.length = 0;
                ship.x = 400; ship.y = 250;
                const m = spawnMutant(700, 120);
                const before = Math.hypot(worldDelta(m.x, ship.x), m.y - ship.y);
                for (let i = 0; i < 40; i++) step(0.016);
                return { before, after: Math.hypot(worldDelta(m.x, ship.x), m.y - ship.y) };
            });
            expect(s.after).toBeLessThan(s.before);
        });

        test('shooting a mutant destroys it and scores', async ({ page }) => {
            const s = await page.evaluate(() => {
                startGame();
                landers.length = 0;
                mutants.length = 0;
                score = 0;
                ship.x = 400; ship.y = 250; ship.dir = 1;
                spawnMutant(440, 250);
                fire();
                for (let i = 0; i < 10; i++) step(0.016);
                return { n: mutants.length, score };
            });
            expect(s.n).toBe(0);
            expect(s.score).toBe(await page.evaluate(() => SCORE_MUTANT));
        });
    });

    // -----------------------------------------------------------------------
    // Humanoid rescue
    // -----------------------------------------------------------------------
    test.describe('humanoid rescue', () => {
        test('shooting a carrying lander drops the humanoid', async ({ page }) => {
            const s = await page.evaluate(() => {
                startGame();
                landers.length = 0;
                humans.length = 0;
                ship.x = 400; ship.y = 250; ship.dir = 1;
                const h = makeHuman(600);
                humans.push(h);
                const l = spawnLander(440, 250);
                l.state = 'carry';
                l.human = h;
                h.state = 'grabbed';
                h.x = 440; h.y = 264;
                fire();
                for (let i = 0; i < 10; i++) step(0.016);
                return { human: h.state, landers: landers.length };
            });
            expect(s.landers).toBe(0);
            expect(s.human).toBe('falling');
        });

        test('a falling humanoid accelerates downward', async ({ page }) => {
            const s = await page.evaluate(() => {
                startGame();
                humans.length = 0;
                const h = makeHuman(600);
                h.state = 'falling';
                h.y = 120; h.vy = 0;
                humans.push(h);
                for (let i = 0; i < 5; i++) step(0.016);
                return { vy: h.vy, y: h.y };
            });
            expect(s.vy).toBeGreaterThan(0);
            expect(s.y).toBeGreaterThan(120);
        });

        test('a gentle landing leaves the humanoid alive on the ground', async ({ page }) => {
            const s = await page.evaluate(() => {
                startGame();
                humans.length = 0;
                const h = makeHuman(600);
                h.state = 'falling';
                h.y = terrainAt(600) - 4;
                h.vy = 0;
                humans.push(h);
                for (let i = 0; i < 20; i++) step(0.016);
                return { state: h.state, alive: humans.length };
            });
            expect(s.alive).toBe(1);
            expect(s.state).toBe('ground');
        });

        test('a high-speed impact kills the humanoid', async ({ page }) => {
            const n = await page.evaluate(() => {
                startGame();
                humans.length = 0;
                const h = makeHuman(600);
                h.state = 'falling';
                h.y = terrainAt(600) - 4;
                h.vy = SAFE_FALL_SPEED * 3;
                humans.push(h);
                for (let i = 0; i < 20; i++) step(0.016);
                return humans.length;
            });
            expect(n).toBe(0);
        });

        test('flying into a falling humanoid catches it', async ({ page }) => {
            const s = await page.evaluate(() => {
                startGame();
                humans.length = 0;
                ship.x = 400; ship.y = 200;
                const h = makeHuman(400);
                h.state = 'falling';
                h.y = 208; h.vy = 0;
                humans.push(h);
                for (let i = 0; i < 4; i++) step(0.016);
                return { state: h.state, carried: carried === h };
            });
            expect(s.state).toBe('carried');
            expect(s.carried).toBe(true);
        });

        test('a carried humanoid follows the ship', async ({ page }) => {
            const s = await page.evaluate(() => {
                startGame();
                humans.length = 0;
                ship.x = 400; ship.y = 200;
                const h = makeHuman(400);
                h.state = 'carried';
                h.y = 208;
                humans.push(h);
                carried = h;
                setThrust(1);
                for (let i = 0; i < 10; i++) step(0.016);
                return { dx: Math.abs(worldDelta(h.x, ship.x)), below: h.y > ship.y };
            });
            expect(s.dx).toBeLessThan(2);
            expect(s.below).toBe(true);
        });

        test('setting a humanoid down near the ground scores a rescue', async ({ page }) => {
            const s = await page.evaluate(() => {
                startGame();
                humans.length = 0;
                score = 0;
                const h = makeHuman(600);
                h.state = 'carried';
                humans.push(h);
                carried = h;
                ship.x = 600;
                ship.y = terrainAt(600) - 6;
                for (let i = 0; i < 6; i++) step(0.016);
                return { state: h.state, score, carried };
            });
            expect(s.state).toBe('ground');
            expect(s.score).toBe(await page.evaluate(() => SCORE_RESCUE));
            expect(s.carried).toBe(null);
        });

        test('the HUD counts surviving humanoids', async ({ page }) => {
            await page.evaluate(() => {
                startGame();
                humans.length = 2;
                step(0.016);
            });
            await expect(page.locator('#humans')).toHaveText('2');
        });

        test('losing every humanoid mutates the remaining landers', async ({ page }) => {
            const s = await page.evaluate(() => {
                startGame();
                mutants.length = 0;
                landers.length = 0;
                spawnLander(300, 200);
                spawnLander(900, 200);
                humans.length = 0;
                for (let i = 0; i < 5; i++) step(0.016);
                return { landers: landers.length, mutants: mutants.length, dead: planetLost };
            });
            expect(s.landers).toBe(0);
            expect(s.mutants).toBe(2);
            expect(s.dead).toBe(true);
        });
    });

    // -----------------------------------------------------------------------
    // Smart bombs
    // -----------------------------------------------------------------------
    test.describe('smart bombs', () => {
        test('a smart bomb clears aliens on screen and spends a bomb', async ({ page }) => {
            const s = await page.evaluate(() => {
                startGame();
                landers.length = 0;
                mutants.length = 0;
                ship.x = 400;
                camX = wrapX(ship.x - CANVAS_W / 2);
                spawnLander(400, 200);
                spawnMutant(420, 240);
                const before = bombs;
                smartBomb();
                return { landers: landers.length, mutants: mutants.length, before, after: bombs };
            });
            expect(s.landers).toBe(0);
            expect(s.mutants).toBe(0);
            expect(s.after).toBe(s.before - 1);
        });

        test('a smart bomb spares aliens off screen', async ({ page }) => {
            const n = await page.evaluate(() => {
                startGame();
                landers.length = 0;
                mutants.length = 0;
                ship.x = 100;
                camX = wrapX(ship.x - CANVAS_W / 2);
                spawnLander(wrapX(ship.x + WORLD_W / 2), 200);
                smartBomb();
                return landers.length;
            });
            expect(n).toBe(1);
        });

        test('a smart bomb with no bombs left does nothing', async ({ page }) => {
            const n = await page.evaluate(() => {
                startGame();
                landers.length = 0;
                bombs = 0;
                ship.x = 400;
                camX = wrapX(ship.x - CANVAS_W / 2);
                spawnLander(400, 200);
                smartBomb();
                return landers.length;
            });
            expect(n).toBe(1);
        });

        test('a smart bomb flashes the screen and the flash fades', async ({ page }) => {
            const s = await page.evaluate(() => {
                startGame();
                smartBomb();
                const lit = flash;
                for (let i = 0; i < 120; i++) step(0.016);
                return { lit, later: flash };
            });
            expect(s.lit).toBeGreaterThan(0);
            expect(s.later).toBe(0);
        });

        test('B triggers a smart bomb', async ({ page }) => {
            await page.evaluate(() => {
                startGame();
                landers.length = 0;
                ship.x = 400;
                camX = wrapX(ship.x - CANVAS_W / 2);
                spawnLander(400, 200);
            });
            await page.keyboard.press('b');
            expect(await page.evaluate(() => landers.length)).toBe(0);
        });
    });

    // -----------------------------------------------------------------------
    // Losing a ship
    // -----------------------------------------------------------------------
    test.describe('losing a ship', () => {
        test('colliding with a lander costs a life', async ({ page }) => {
            const s = await page.evaluate(() => {
                startGame();
                landers.length = 0;
                mutants.length = 0;
                ship.invuln = 0;                            // past the spawn grace period
                const before = lives;
                ship.x = 400; ship.y = 250;
                spawnLander(402, 250);
                for (let i = 0; i < 3; i++) step(0.016);
                return { before, after: lives, state: ship.dead };
            });
            expect(s.after).toBe(s.before - 1);
            expect(s.state).toBe(true);
        });

        test('an enemy shot costs a life', async ({ page }) => {
            const s = await page.evaluate(() => {
                startGame();
                landers.length = 0;
                mutants.length = 0;
                enemyBullets.length = 0;
                ship.invuln = 0;                            // past the spawn grace period
                const before = lives;
                ship.x = 400; ship.y = 250;
                enemyBullets.push({ x: 402, y: 250, vx: 0, vy: 0, life: 3 });
                for (let i = 0; i < 3; i++) step(0.016);
                return { before, after: lives };
            });
            expect(s.after).toBe(s.before - 1);
        });

        test('the gun outreaches the hull, so a shot from just off-altitude is safe', async ({ page }) => {
            const s = await page.evaluate(() => ({ reach: BULLET_REACH_Y, hull: SHIP_H / 2 + ALIEN_R / 2 }));
            expect(s.reach).toBeGreaterThan(s.hull);
        });

        test('an alien a little above the ship does not clip it', async ({ page }) => {
            const s = await page.evaluate(() => {
                startGame();
                landers.length = 0;
                mutants.length = 0;
                ship.invuln = 0;
                const before = lives;
                ship.x = 400; ship.y = 250;
                spawnLander(400, 250 - (SHIP_H / 2 + ALIEN_R / 2) - 1);
                step(0.016);
                return { before, after: lives };
            });
            expect(s.after).toBe(s.before);
        });

        test('the ship respawns after the delay and is briefly invulnerable', async ({ page }) => {
            const s = await page.evaluate(() => {
                startGame();
                landers.length = 0;
                mutants.length = 0;
                killPlayer();
                for (let i = 0; i < Math.ceil(RESPAWN_TIME / 0.016) + 2; i++) step(0.016);
                return { dead: ship.dead, invuln: ship.invuln > 0 };
            });
            expect(s.dead).toBe(false);
            expect(s.invuln).toBe(true);
        });

        test('an invulnerable ship survives a collision', async ({ page }) => {
            const s = await page.evaluate(() => {
                startGame();
                landers.length = 0;
                mutants.length = 0;
                ship.invuln = 3;
                const before = lives;
                ship.x = 400; ship.y = 250;
                spawnLander(402, 250);
                for (let i = 0; i < 3; i++) step(0.016);
                return { before, after: lives };
            });
            expect(s.after).toBe(s.before);
        });

        test('a carried humanoid is dropped when the ship is destroyed', async ({ page }) => {
            const s = await page.evaluate(() => {
                startGame();
                humans.length = 0;
                const h = makeHuman(600);
                h.state = 'carried';
                h.y = 200;
                humans.push(h);
                carried = h;
                killPlayer();
                return { state: h.state, carried };
            });
            expect(s.state).toBe('falling');
            expect(s.carried).toBe(null);
        });

        test('running out of lives ends the game', async ({ page }) => {
            const s = await page.evaluate(() => {
                startGame();
                lives = 1;
                killPlayer();
                return state;
            });
            expect(s).toBe('over');
        });

        test('the overlay announces game over', async ({ page }) => {
            await page.evaluate(() => { startGame(); lives = 1; killPlayer(); });
            await expect(page.locator('#overlay')).toHaveClass(/visible/);
            await expect(page.locator('#overlay-title')).toContainText(/game over/i);
            await expect(page.locator('#btn-start')).toHaveText(/play again/i);
        });

        test('nothing moves once the game is over', async ({ page }) => {
            const moved = await page.evaluate(() => {
                startGame();
                lives = 1;
                killPlayer();
                const before = { x: ship.x, y: ship.y };
                for (let i = 0; i < 30; i++) step(0.016);
                return ship.x !== before.x || ship.y !== before.y;
            });
            expect(moved).toBe(false);
        });
    });

    // -----------------------------------------------------------------------
    // Waves
    // -----------------------------------------------------------------------
    test.describe('waves', () => {
        test('the next wave waits for the clear-out beat', async ({ page }) => {
            const s = await page.evaluate(() => {
                startGame();
                landers.length = 0;
                mutants.length = 0;
                for (let i = 0; i < 5; i++) step(0.016);
                return { wave, landers: landers.length };
            });
            expect(s.wave).toBe(1);
            expect(s.landers).toBe(0);
        });

        test('clearing every alien starts the next wave', async ({ page }) => {
            const s = await page.evaluate(() => {
                startGame();
                landers.length = 0;
                mutants.length = 0;
                for (let i = 0; i < Math.ceil(WAVE_CLEAR_DELAY / 0.016) + 5; i++) step(0.016);
                return { wave, landers: landers.length };
            });
            expect(s.wave).toBe(2);
            expect(s.landers).toBeGreaterThan(0);
        });

        test('later waves send more landers', async ({ page }) => {
            const s = await page.evaluate(() => {
                startGame();
                const first = landers.length;
                landers.length = 0;
                wave = 4;
                nextWave();
                return { first, later: landers.length };
            });
            expect(s.later).toBeGreaterThan(s.first);
        });

        test('the lander count is capped', async ({ page }) => {
            const s = await page.evaluate(() => {
                startGame();
                landers.length = 0;
                wave = 40;
                nextWave();
                return { n: landers.length, cap: MAX_WAVE_LANDERS };
            });
            expect(s.n).toBeLessThanOrEqual(s.cap);
        });

        test('surviving humanoids pay a bonus at the end of a wave', async ({ page }) => {
            const s = await page.evaluate(() => {
                startGame();
                score = 0;
                humans.length = 3;
                landers.length = 0;
                mutants.length = 0;
                for (let i = 0; i < Math.ceil(WAVE_CLEAR_DELAY / 0.016) + 5; i++) step(0.016);
                return score;
            });
            expect(s).toBe(3 * (await page.evaluate(() => SCORE_HUMAN_BONUS)));
        });

        test('a wave grants a smart bomb', async ({ page }) => {
            const s = await page.evaluate(() => {
                startGame();
                bombs = 1;
                landers.length = 0;
                mutants.length = 0;
                for (let i = 0; i < Math.ceil(WAVE_CLEAR_DELAY / 0.016) + 5; i++) step(0.016);
                return bombs;
            });
            expect(s).toBe(2);
        });

        test('a new wave announces itself on the canvas', async ({ page }) => {
            const s = await page.evaluate(() => {
                startGame();
                landers.length = 0;
                mutants.length = 0;
                for (let i = 0; i < Math.ceil(WAVE_CLEAR_DELAY / 0.016) + 5; i++) step(0.016);
                const shown = bannerTimer;
                for (let i = 0; i < Math.ceil(BANNER_TIME / 0.016) + 5; i++) step(0.016);
                return { shown, later: bannerTimer };
            });
            expect(s.shown).toBeGreaterThan(0);
            expect(s.later).toBe(0);
        });

        test('the HUD shows the wave number', async ({ page }) => {
            await page.evaluate(() => {
                startGame();
                landers.length = 0;
                mutants.length = 0;
                for (let i = 0; i < Math.ceil(WAVE_CLEAR_DELAY / 0.016) + 5; i++) step(0.016);
            });
            await expect(page.locator('#wave')).toHaveText('2');
        });
    });

    // -----------------------------------------------------------------------
    // Scoring & high score
    // -----------------------------------------------------------------------
    test.describe('score', () => {
        test('the HUD shows the score', async ({ page }) => {
            await page.evaluate(() => { startGame(); addScore(750); step(0.016); });
            await expect(page.locator('#score')).toHaveText('750');
        });

        test('the high score is kept when the game ends', async ({ page }) => {
            await page.evaluate(() => {
                startGame();
                score = 3300;
                lives = 1;
                killPlayer();
            });
            await expect(page.locator('#high')).toHaveText('3300');
            const stored = await page.evaluate(() => localStorage.getItem('defender-highscore'));
            expect(parseInt(stored, 10)).toBe(3300);
        });

        test('a lower score does not replace the high score', async ({ page }) => {
            await page.evaluate(() => localStorage.setItem('defender-highscore', '9000'));
            await page.reload();
            await page.evaluate(() => {
                startGame();
                score = 100;
                lives = 1;
                killPlayer();
            });
            await expect(page.locator('#high')).toHaveText('9000');
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

        test('pausing freezes the world', async ({ page }) => {
            const moved = await page.evaluate(() => {
                startGame();
                setThrust(1);
                for (let i = 0; i < 10; i++) step(0.016);
                togglePause();
                const before = ship.x;
                for (let i = 0; i < 20; i++) step(0.016);
                return ship.x !== before;
            });
            expect(moved).toBe(false);
        });

        test('Space restarts after game over', async ({ page }) => {
            await page.evaluate(() => { startGame(); lives = 1; killPlayer(); });
            await page.keyboard.press('Space');
            expect(await page.evaluate(() => state)).toBe('running');
        });

        test('restarting clears leftover aliens and shots', async ({ page }) => {
            const s = await page.evaluate(() => {
                startGame();
                spawnMutant(300, 200);
                fire();
                enemyBullets.push({ x: 10, y: 10, vx: 0, vy: 0, life: 1 });
                lives = 1;
                killPlayer();
                startGame();
                return { mutants: mutants.length, bullets: bullets.length, enemy: enemyBullets.length };
            });
            expect(s).toEqual({ mutants: 0, bullets: 0, enemy: 0 });
        });
    });

    // -----------------------------------------------------------------------
    // Stability
    // -----------------------------------------------------------------------
    test.describe('stability', () => {
        test('a long unattended run stays consistent', async ({ page }) => {
            const s = await page.evaluate(() => {
                startGame();
                for (let i = 0; i < 1500; i++) step(0.016);
                const finite = (o) => Number.isFinite(o.x) && Number.isFinite(o.y);
                return {
                    ok: [ship, ...landers, ...mutants, ...humans, ...bullets, ...enemyBullets].every(finite),
                    inWorld: [...landers, ...mutants].every((e) => e.x >= 0 && e.x < WORLD_W),
                    state,
                };
            });
            expect(s.ok).toBe(true);
            expect(s.inWorld).toBe(true);
            expect(['running', 'over']).toContain(s.state);
        });

        test('the canvas actually renders', async ({ page }) => {
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

        test('there are no console errors during play', async ({ page }) => {
            const errors = [];
            page.on('pageerror', (e) => errors.push(e.message));
            await page.reload();
            await page.keyboard.press('Space');
            await page.evaluate(() => { for (let i = 0; i < 200; i++) { step(0.016); draw(); } });
            expect(errors).toEqual([]);
        });
    });
});
