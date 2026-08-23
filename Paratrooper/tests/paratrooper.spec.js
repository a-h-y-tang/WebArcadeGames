const { test, expect } = require('@playwright/test');
const path = require('path');
const { pathToFileURL } = require('url');

const GAME_URL = pathToFileURL(path.resolve(__dirname, '../index.html')).href;

// Most tests want a running game containing only the units they create
// themselves, so they start the game and then push the automatic wave timer
// out of reach. The few tests that are *about* the waves leave it alone.
const startQuiet = () => {
    startGame();
    spawnTimer = Number.POSITIVE_INFINITY;
};

test.describe('Paratrooper', () => {
    test.beforeEach(async ({ page }) => {
        await page.goto(GAME_URL);
    });

    // -----------------------------------------------------------------------
    // Initial / idle state
    // -----------------------------------------------------------------------
    test.describe('initial state', () => {
        test('page title is Paratrooper', async ({ page }) => {
            await expect(page).toHaveTitle('Paratrooper');
        });

        test('canvas is 640x420', async ({ page }) => {
            const canvas = page.locator('#canvas');
            await expect(canvas).toHaveAttribute('width', '640');
            await expect(canvas).toHaveAttribute('height', '420');
        });

        test('start overlay is visible and prompts the player', async ({ page }) => {
            await expect(page.locator('#overlay')).toHaveClass(/visible/);
            await expect(page.locator('#overlay-sub')).toContainText(/space|start/i);
        });

        test('hud starts at zero', async ({ page }) => {
            await expect(page.locator('#score')).toHaveText('0');
            await expect(page.locator('#best')).toHaveText('0');
            await expect(page.locator('#wave')).toHaveText('1');
            await expect(page.locator('#stack-left')).toHaveText('0');
            await expect(page.locator('#stack-right')).toHaveText('0');
        });

        test('state is idle before starting', async ({ page }) => {
            expect(await page.evaluate(() => state)).toBe('idle');
        });

        test('stepping while idle does nothing', async ({ page }) => {
            const changed = await page.evaluate(() => {
                spawnHelicopter('left', 100);
                const before = helicopters[0].x;
                for (let i = 0; i < 30; i++) step(0.016);
                return helicopters[0].x !== before;
            });
            expect(changed).toBe(false);
        });

        test('best score loads from localStorage', async ({ page }) => {
            await page.evaluate(() => window.localStorage.setItem('paratrooper-best', '640'));
            await page.reload();
            await expect(page.locator('#best')).toHaveText('640');
        });

        test('the gun sits on top of the tower, above the sand', async ({ page }) => {
            const geom = await page.evaluate(() => ({
                towerX: TOWER_X, w: CANVAS_W, pivot: PIVOT_Y,
                towerTop: TOWER_TOP, ground: GROUND_Y, maxAngle: MAX_ANGLE,
            }));
            expect(geom.towerX).toBe(geom.w / 2);
            expect(geom.pivot).toBe(geom.towerTop);
            expect(geom.towerTop).toBeLessThan(geom.ground);
            // The gun can never point at or below the horizon.
            expect(geom.maxAngle).toBeLessThan(Math.PI / 2);
        });

        test('helicopters cruise above the tower', async ({ page }) => {
            const geom = await page.evaluate(() => ({
                min: HELI_MIN_Y, max: HELI_MAX_Y, towerTop: TOWER_TOP,
            }));
            expect(geom.min).toBeLessThan(geom.max);
            expect(geom.max).toBeLessThan(geom.towerTop);
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

        test('a fresh game has an empty sky and no score', async ({ page }) => {
            const snapshot = await page.evaluate(() => {
                startGame();
                return {
                    bullets: bullets.length,
                    helicopters: helicopters.length,
                    troopers: troopers.length,
                    score, wave, angle: turret.angle,
                };
            });
            expect(snapshot).toEqual({
                bullets: 0, helicopters: 0, troopers: 0, score: 0, wave: 1, angle: 0,
            });
        });

        test('restarting clears the wreckage of the previous run', async ({ page }) => {
            const snapshot = await page.evaluate(() => {
                startGame();
                score = 250;
                spawnHelicopter('left', 90);
                spawnTrooper(120, 200);
                fire();
                startGame();
                return {
                    bullets: bullets.length,
                    helicopters: helicopters.length,
                    troopers: troopers.length,
                    score,
                };
            });
            expect(snapshot).toEqual({ bullets: 0, helicopters: 0, troopers: 0, score: 0 });
        });
    });

    // -----------------------------------------------------------------------
    // The gun
    // -----------------------------------------------------------------------
    test.describe('gun', () => {
        test.beforeEach(async ({ page }) => {
            await page.evaluate(startQuiet);
        });

        test('the gun starts pointing straight up', async ({ page }) => {
            expect(await page.evaluate(() => turret.angle)).toBe(0);
        });

        test('holding left swings the barrel left', async ({ page }) => {
            await page.keyboard.down('ArrowLeft');
            const angle = await page.evaluate(() => {
                for (let i = 0; i < 10; i++) step(0.016);
                return turret.angle;
            });
            await page.keyboard.up('ArrowLeft');
            expect(angle).toBeLessThan(0);
        });

        test('holding right swings the barrel right', async ({ page }) => {
            await page.keyboard.down('ArrowRight');
            const angle = await page.evaluate(() => {
                for (let i = 0; i < 10; i++) step(0.016);
                return turret.angle;
            });
            await page.keyboard.up('ArrowRight');
            expect(angle).toBeGreaterThan(0);
        });

        test('releasing the key stops the swing', async ({ page }) => {
            await page.keyboard.down('ArrowRight');
            await page.evaluate(() => { for (let i = 0; i < 10; i++) step(0.016); });
            await page.keyboard.up('ArrowRight');
            const held = await page.evaluate(() => {
                const before = turret.angle;
                for (let i = 0; i < 10; i++) step(0.016);
                return turret.angle === before;
            });
            expect(held).toBe(true);
        });

        test('the barrel cannot swing past its limit', async ({ page }) => {
            const angles = await page.evaluate(() => {
                turret.dir = 1;
                for (let i = 0; i < 400; i++) step(0.016);
                const right = turret.angle;
                turret.dir = -1;
                for (let i = 0; i < 800; i++) step(0.016);
                return { right, left: turret.angle, max: MAX_ANGLE };
            });
            expect(angles.right).toBeCloseTo(angles.max, 5);
            expect(angles.left).toBeCloseTo(-angles.max, 5);
        });

        test('the gun does not swing while idle', async ({ page }) => {
            const angle = await page.evaluate(() => {
                state = 'idle';
                turret.dir = 1;
                for (let i = 0; i < 20; i++) step(0.016);
                return turret.angle;
            });
            expect(angle).toBe(0);
        });
    });

    // -----------------------------------------------------------------------
    // Firing
    // -----------------------------------------------------------------------
    test.describe('firing', () => {
        test.beforeEach(async ({ page }) => {
            await page.evaluate(startQuiet);
        });

        test('Space fires a shell', async ({ page }) => {
            await page.keyboard.press('Space');
            expect(await page.evaluate(() => bullets.length)).toBe(1);
        });

        test('a shell leaves the muzzle heading up along the barrel', async ({ page }) => {
            const shot = await page.evaluate(() => {
                turret.angle = 0;
                fire();
                const b = bullets[0];
                return { x: b.x, y: b.y, vx: b.vx, vy: b.vy, pivot: PIVOT_Y, towerX: TOWER_X };
            });
            expect(shot.x).toBeCloseTo(shot.towerX, 5);
            expect(shot.y).toBeLessThan(shot.pivot);
            expect(shot.vx).toBeCloseTo(0, 5);
            expect(shot.vy).toBeLessThan(0);
        });

        test('a shell fired to the right travels right', async ({ page }) => {
            const vel = await page.evaluate(() => {
                turret.angle = 1;
                fire();
                return { vx: bullets[0].vx, vy: bullets[0].vy };
            });
            expect(vel.vx).toBeGreaterThan(0);
            expect(vel.vy).toBeLessThan(0);
        });

        test('shells move on each step', async ({ page }) => {
            const moved = await page.evaluate(() => {
                fire();
                const before = bullets[0].y;
                step(0.1);
                return before - bullets[0].y;
            });
            expect(moved).toBeGreaterThan(0);
        });

        test('the cooldown limits the rate of fire', async ({ page }) => {
            const count = await page.evaluate(() => {
                fire();
                fire();
                fire();
                return bullets.length;
            });
            expect(count).toBe(1);
        });

        test('firing again is allowed once the cooldown expires', async ({ page }) => {
            const count = await page.evaluate(() => {
                fire();
                step(FIRE_COOLDOWN + 0.01);
                fire();
                return bullets.length;
            });
            expect(count).toBe(2);
        });

        test('no more than MAX_BULLETS shells are in flight', async ({ page }) => {
            const result = await page.evaluate(() => {
                for (let i = 0; i < 20; i++) {
                    turret.cooldown = 0;
                    fire();
                }
                return { count: bullets.length, max: MAX_BULLETS };
            });
            expect(result.count).toBe(result.max);
        });

        test('shells are cleaned up once they leave the screen', async ({ page }) => {
            const count = await page.evaluate(() => {
                fire();
                for (let i = 0; i < 200; i++) step(0.016);
                return bullets.length;
            });
            expect(count).toBe(0);
        });

        test('holding Space keeps firing at the cooldown rate', async ({ page }) => {
            const count = await page.evaluate(() => {
                const held = () => window.dispatchEvent(
                    new KeyboardEvent('keydown', { key: ' ', code: 'Space', repeat: true }),
                );
                held();
                step(FIRE_COOLDOWN + 0.01);
                held();
                step(FIRE_COOLDOWN + 0.01);
                held();
                return bullets.length;
            });
            expect(count).toBe(3);
        });

        test('firing lights a muzzle flash that dies down', async ({ page }) => {
            const flash = await page.evaluate(() => {
                const before = muzzleFlash;
                fire();
                const lit = muzzleFlash;
                step(0.3);
                return { before, lit, after: muzzleFlash };
            });
            expect(flash.before).toBe(0);
            expect(flash.lit).toBeGreaterThan(0);
            expect(flash.after).toBeLessThanOrEqual(0);
        });

        test('firing while idle does nothing', async ({ page }) => {
            const count = await page.evaluate(() => {
                state = 'idle';
                bullets.length = 0;
                turret.cooldown = 0;
                fire();
                return bullets.length;
            });
            expect(count).toBe(0);
        });
    });

    // -----------------------------------------------------------------------
    // Helicopters
    // -----------------------------------------------------------------------
    test.describe('helicopters', () => {
        test.beforeEach(async ({ page }) => {
            await page.evaluate(startQuiet);
        });

        test('one spawned on the left flies right, and vice versa', async ({ page }) => {
            const dirs = await page.evaluate(() => {
                spawnHelicopter('left', 100);
                spawnHelicopter('right', 140);
                return { left: helicopters[0].vx, right: helicopters[1].vx };
            });
            expect(dirs.left).toBeGreaterThan(0);
            expect(dirs.right).toBeLessThan(0);
        });

        test('a helicopter spawns off-screen and flies in', async ({ page }) => {
            const flight = await page.evaluate(() => {
                spawnHelicopter('left', 100);
                const start = helicopters[0].x;
                for (let i = 0; i < 60; i++) step(0.016);
                return { start, after: helicopters[0].x };
            });
            expect(flight.start).toBeLessThan(0);
            expect(flight.after).toBeGreaterThan(flight.start);
        });

        test('a helicopter that crosses the screen is removed', async ({ page }) => {
            const count = await page.evaluate(() => {
                spawnHelicopter('left', 100);
                helicopters[0].troopsLeft = 0;
                for (let i = 0; i < 900; i++) step(0.016);
                return helicopters.length;
            });
            expect(count).toBe(0);
        });

        test('a shell through the fuselage destroys it and scores', async ({ page }) => {
            const result = await page.evaluate(() => {
                spawnHelicopter('left', 100);
                const h = helicopters[0];
                h.x = 200;
                bullets.push({ x: h.x, y: h.y, vx: 0, vy: -1 });
                step(0.016);
                return {
                    helicopters: helicopters.length,
                    bullets: bullets.length,
                    score,
                    award: SCORE_HELI,
                };
            });
            expect(result.helicopters).toBe(0);
            expect(result.bullets).toBe(0);
            expect(result.score).toBe(result.award);
        });

        test('a shell that misses leaves the helicopter alone', async ({ page }) => {
            const result = await page.evaluate(() => {
                spawnHelicopter('left', 100);
                const h = helicopters[0];
                h.x = 200;
                bullets.push({ x: h.x, y: h.y - 120, vx: 0, vy: -1 });
                step(0.016);
                return { helicopters: helicopters.length, score };
            });
            expect(result.helicopters).toBe(1);
            expect(result.score).toBe(0);
        });

        test('a helicopter drops troopers while over the drop zone', async ({ page }) => {
            const dropped = await page.evaluate(() => {
                spawnHelicopter('left', 100);
                helicopters[0].x = 160;
                helicopters[0].dropTimer = 0;
                step(0.016);
                return troopers.length;
            });
            expect(dropped).toBeGreaterThan(0);
        });

        test('a helicopter carries a limited number of troopers', async ({ page }) => {
            const result = await page.evaluate(() => {
                spawnHelicopter('left', 100);
                const capacity = helicopters[0].troopsLeft;
                for (let i = 0; i < 900 && helicopters.length; i++) {
                    helicopters[0].dropTimer = 0;
                    step(0.016);
                }
                return { capacity, dropped: troopers.length, limit: HELI_CAPACITY };
            });
            expect(result.capacity).toBe(result.limit);
            expect(result.dropped).toBe(result.limit);
        });

        test('a helicopter never drops directly over the tower', async ({ page }) => {
            const dropped = await page.evaluate(() => {
                spawnHelicopter('left', 100);
                helicopters[0].x = TOWER_X;
                helicopters[0].dropTimer = 0;
                step(0.016);
                return troopers.length;
            });
            expect(dropped).toBe(0);
        });

        test('destroying a helicopter takes its remaining troopers with it', async ({ page }) => {
            const stillFalling = await page.evaluate(() => {
                spawnHelicopter('left', 100);
                const h = helicopters[0];
                h.x = 200;
                bullets.push({ x: h.x, y: h.y, vx: 0, vy: -1 });
                step(0.016);
                return troopers.length;
            });
            expect(stillFalling).toBe(0);
        });
    });

    // -----------------------------------------------------------------------
    // Paratroopers
    // -----------------------------------------------------------------------
    test.describe('paratroopers', () => {
        test.beforeEach(async ({ page }) => {
            await page.evaluate(startQuiet);
        });

        test('a dropped trooper descends under a chute', async ({ page }) => {
            const fall = await page.evaluate(() => {
                spawnTrooper(120, 100);
                const t = troopers[0];
                const before = t.y;
                step(1);
                return { phase: t.phase, dropped: t.y - before, rate: CHUTE_FALL };
            });
            expect(fall.phase).toBe('chute');
            expect(fall.dropped).toBeCloseTo(fall.rate, 1);
        });

        test('a shell hits a trooper in the air and scores', async ({ page }) => {
            const result = await page.evaluate(() => {
                spawnTrooper(120, 100);
                bullets.push({ x: 120, y: 100, vx: 0, vy: -1 });
                step(0.016);
                return {
                    troopers: troopers.length,
                    bullets: bullets.length,
                    score,
                    award: SCORE_TROOPER,
                };
            });
            expect(result.troopers).toBe(0);
            expect(result.bullets).toBe(0);
            expect(result.score).toBe(result.award);
        });

        test('a trooper who reaches the sand starts walking', async ({ page }) => {
            const t = await page.evaluate(() => {
                spawnTrooper(120, GROUND_Y - 20);
                for (let i = 0; i < 60; i++) step(0.016);
                const t = troopers[0];
                return { phase: t.phase, y: t.y, side: t.side, ground: GROUND_Y };
            });
            expect(t.phase).toBe('walk');
            expect(t.y).toBeCloseTo(t.ground, 0);
            expect(t.side).toBe('left');
        });

        test('a trooper landing right of the tower belongs to the right side', async ({ page }) => {
            const side = await page.evaluate(() => {
                spawnTrooper(TOWER_X + 150, GROUND_Y - 10);
                for (let i = 0; i < 60; i++) step(0.016);
                return troopers[0].side;
            });
            expect(side).toBe('right');
        });

        test('a landed trooper walks toward the tower', async ({ page }) => {
            const walk = await page.evaluate(() => {
                spawnTrooper(60, GROUND_Y - 5);
                for (let i = 0; i < 10; i++) step(0.016);
                const before = troopers[0].x;
                for (let i = 0; i < 30; i++) step(0.016);
                return { before, after: troopers[0].x };
            });
            expect(walk.after).toBeGreaterThan(walk.before);
        });

        test('a trooper on the right walks left toward the tower', async ({ page }) => {
            const walk = await page.evaluate(() => {
                spawnTrooper(CANVAS_W - 60, GROUND_Y - 5);
                for (let i = 0; i < 10; i++) step(0.016);
                const before = troopers[0].x;
                for (let i = 0; i < 30; i++) step(0.016);
                return { before, after: troopers[0].x };
            });
            expect(walk.after).toBeLessThan(walk.before);
        });

        test('shells pass harmlessly over a landed trooper', async ({ page }) => {
            const result = await page.evaluate(() => {
                spawnTrooper(120, GROUND_Y - 2);
                for (let i = 0; i < 20; i++) step(0.016);
                const t = troopers[0];
                bullets.push({ x: t.x, y: t.y, vx: 0, vy: -1 });
                step(0.016);
                return { phase: t.phase, troopers: troopers.length, score };
            });
            expect(result.phase).not.toBe('chute');
            expect(result.troopers).toBe(1);
            expect(result.score).toBe(0);
        });

        test('a walking trooper stops when it reaches the tower', async ({ page }) => {
            const t = await page.evaluate(() => {
                spawnTrooper(60, GROUND_Y - 5);
                for (let i = 0; i < 900; i++) step(0.016);
                const t = troopers[0];
                return { phase: t.phase, x: t.x, index: t.stackIndex, towerX: TOWER_X };
            });
            expect(t.phase).toBe('stacked');
            expect(t.index).toBe(0);
            expect(t.x).toBeLessThan(t.towerX);
        });

        test('troopers stack outward from the tower', async ({ page }) => {
            const stack = await page.evaluate(() => {
                spawnTrooper(60, GROUND_Y - 5);
                for (let i = 0; i < 900; i++) step(0.016);
                spawnTrooper(60, GROUND_Y - 5);
                for (let i = 0; i < 900; i++) step(0.016);
                return troopers.map((t) => ({ x: t.x, phase: t.phase, index: t.stackIndex }));
            });
            expect(stack).toHaveLength(2);
            expect(stack.every((t) => t.phase === 'stacked')).toBe(true);
            expect(stack[1].index).toBe(1);
            // The second arrival stands further from the tower than the first.
            expect(stack[1].x).toBeLessThan(stack[0].x);
        });

        test('the stack counters in the hud track landings', async ({ page }) => {
            await page.evaluate(() => {
                spawnTrooper(60, GROUND_Y - 5);
                spawnTrooper(CANVAS_W - 60, GROUND_Y - 5);
                spawnTrooper(CANVAS_W - 90, GROUND_Y - 5);
                for (let i = 0; i < 900; i++) step(0.016);
            });
            await expect(page.locator('#stack-left')).toHaveText('1');
            await expect(page.locator('#stack-right')).toHaveText('2');
        });

        test('countStack ignores troopers still in the air', async ({ page }) => {
            const counts = await page.evaluate(() => {
                spawnTrooper(100, 100);
                return { left: countStack('left'), right: countStack('right') };
            });
            expect(counts).toEqual({ left: 0, right: 0 });
        });
    });

    // -----------------------------------------------------------------------
    // Losing
    // -----------------------------------------------------------------------
    test.describe('game over', () => {
        const overrun = () => {
            startGame();
            spawnTimer = Number.POSITIVE_INFINITY;
            for (let i = 0; i < STACK_LIMIT; i++) spawnTrooper(40 + i * 20, GROUND_Y - 5);
            for (let i = 0; i < 1500 && state === 'running'; i++) step(0.016);
        };

        test('a full stack on one side ends the game', async ({ page }) => {
            await page.evaluate(overrun);
            expect(await page.evaluate(() => state)).toBe('over');
        });

        test('the overlay announces the loss', async ({ page }) => {
            await page.evaluate(overrun);
            await expect(page.locator('#overlay')).toHaveClass(/visible/);
            await expect(page.locator('#overlay-title')).toContainText(/over|overrun/i);
        });

        test('troopers split across both sides do not end the game', async ({ page }) => {
            const result = await page.evaluate(() => {
                startGame();
                spawnTimer = Number.POSITIVE_INFINITY;
                for (let i = 0; i < 3; i++) spawnTrooper(40 + i * 20, GROUND_Y - 5);
                for (let i = 0; i < 3; i++) spawnTrooper(CANVAS_W - 40 - i * 20, GROUND_Y - 5);
                for (let i = 0; i < 1500; i++) step(0.016);
                return { state, left: countStack('left'), right: countStack('right') };
            });
            expect(result).toEqual({ state: 'running', left: 3, right: 3 });
        });

        test('the simulation freezes once the game is over', async ({ page }) => {
            const frozen = await page.evaluate(() => {
                startGame();
                state = 'over';
                spawnHelicopter('left', 100);
                const before = helicopters[0].x;
                for (let i = 0; i < 30; i++) step(0.016);
                return helicopters[0].x === before;
            });
            expect(frozen).toBe(true);
        });

        test('the best score is kept across runs', async ({ page }) => {
            const best = await page.evaluate(() => {
                startGame();
                score = 175;
                gameOver();
                return window.localStorage.getItem('paratrooper-best');
            });
            expect(best).toBe('175');
            await expect(page.locator('#best')).toHaveText('175');
        });

        test('a lower score does not replace the best', async ({ page }) => {
            const best = await page.evaluate(() => {
                startGame();
                score = 300;
                gameOver();
                startGame();
                score = 20;
                gameOver();
                return window.localStorage.getItem('paratrooper-best');
            });
            expect(best).toBe('300');
        });

        test('R restarts after a loss', async ({ page }) => {
            await page.evaluate(overrun);
            await page.keyboard.press('r');
            const snapshot = await page.evaluate(() => ({ state, troopers: troopers.length }));
            expect(snapshot).toEqual({ state: 'running', troopers: 0 });
        });

        test('Space restarts after a loss', async ({ page }) => {
            await page.evaluate(overrun);
            await page.keyboard.press('Space');
            expect(await page.evaluate(() => state)).toBe('running');
        });

        test('a Space still held from the last shot does not restart', async ({ page }) => {
            await page.evaluate(overrun);
            const after = await page.evaluate(() => {
                window.dispatchEvent(
                    new KeyboardEvent('keydown', { key: ' ', code: 'Space', repeat: true }),
                );
                return state;
            });
            expect(after).toBe('over');
        });
    });

    // -----------------------------------------------------------------------
    // Pause
    // -----------------------------------------------------------------------
    test.describe('pause', () => {
        test('P pauses and resumes', async ({ page }) => {
            await page.evaluate(startQuiet);
            await page.keyboard.press('p');
            expect(await page.evaluate(() => state)).toBe('paused');
            await expect(page.locator('#overlay')).toHaveClass(/visible/);
            await page.keyboard.press('p');
            expect(await page.evaluate(() => state)).toBe('running');
            await expect(page.locator('#overlay')).not.toHaveClass(/visible/);
        });

        test('nothing moves while paused', async ({ page }) => {
            const frozen = await page.evaluate(() => {
                startGame();
                spawnTrooper(120, 100);
                state = 'paused';
                const before = troopers[0].y;
                for (let i = 0; i < 30; i++) step(0.016);
                return troopers[0].y === before;
            });
            expect(frozen).toBe(true);
        });

        test('Space does not wipe a paused run', async ({ page }) => {
            const after = await page.evaluate(startQuiet);
            expect(after).toBeUndefined();
            await page.evaluate(() => { score = 90; });
            await page.keyboard.press('p');
            await page.keyboard.press('Space');
            expect(await page.evaluate(() => ({ state, score })))
                .toEqual({ state: 'paused', score: 90 });
        });

        test('P does nothing on the title screen', async ({ page }) => {
            await page.keyboard.press('p');
            expect(await page.evaluate(() => state)).toBe('idle');
        });
    });

    // -----------------------------------------------------------------------
    // Difficulty
    // -----------------------------------------------------------------------
    test.describe('waves', () => {
        test('the wave advances with time played', async ({ page }) => {
            const wave = await page.evaluate(() => {
                startGame();
                spawnTimer = Number.POSITIVE_INFINITY;
                for (let i = 0; i < 3; i++) step(WAVE_SECONDS / 3);
                return window.wave;
            });
            expect(wave).toBe(2);
            await expect(page.locator('#wave')).toHaveText('2');
        });

        test('a new wave raises a banner that fades away', async ({ page }) => {
            const banner = await page.evaluate(() => {
                startGame();
                spawnTimer = Number.POSITIVE_INFINITY;
                const atStart = waveBanner;
                // Frame-sized steps, so the banner is not raised and drained
                // inside a single coarse call.
                while (wave === 1 && elapsed < WAVE_SECONDS * 2) step(1 / 60);
                const onChange = waveBanner;
                for (let i = 0; i < 200; i++) step(0.016);
                return { atStart, onChange, later: waveBanner };
            });
            expect(banner.atStart).toBe(0);
            expect(banner.onChange).toBeGreaterThan(0);
            expect(banner.later).toBeLessThanOrEqual(0);
        });

        test('later waves send faster helicopters', async ({ page }) => {
            const speeds = await page.evaluate(() => {
                startGame();
                spawnTimer = Number.POSITIVE_INFINITY;
                spawnHelicopter('left', 100);
                const early = Math.abs(helicopters[0].vx);
                wave = 6;
                spawnHelicopter('left', 100);
                const late = Math.abs(helicopters[1].vx);
                return { early, late };
            });
            expect(speeds.late).toBeGreaterThan(speeds.early);
        });

        test('later waves send helicopters more often', async ({ page }) => {
            const intervals = await page.evaluate(() => {
                startGame();
                const early = spawnInterval();
                wave = 8;
                const late = spawnInterval();
                return { early, late };
            });
            expect(intervals.late).toBeLessThan(intervals.early);
        });

        test('helicopters arrive on their own as the game runs', async ({ page }) => {
            const seen = await page.evaluate(() => {
                seedRng(7);
                startGame();
                let most = 0;
                for (let i = 0; i < 600; i++) {
                    step(0.016);
                    most = Math.max(most, helicopters.length);
                }
                return most;
            });
            expect(seen).toBeGreaterThan(0);
        });
    });

    // -----------------------------------------------------------------------
    // Determinism & rendering
    // -----------------------------------------------------------------------
    test.describe('engine', () => {
        test('the same seed produces the same run', async ({ page }) => {
            const run = () => page.evaluate(() => {
                seedRng(1234);
                startGame();
                for (let i = 0; i < 400; i++) step(0.016);
                return helicopters.map((h) => [Math.round(h.x), Math.round(h.y)]);
            });
            const a = await run();
            const b = await run();
            expect(a).toEqual(b);
            expect(a.length).toBeGreaterThan(0);
        });

        test('the canvas is actually painted', async ({ page }) => {
            const colours = await page.evaluate(() => {
                startGame();
                spawnHelicopter('left', 100);
                helicopters[0].x = 200;
                spawnTrooper(400, 150);
                fire();
                draw();
                const data = ctx.getImageData(0, 0, CANVAS_W, CANVAS_H).data;
                const seen = new Set();
                for (let i = 0; i < data.length; i += 4) {
                    seen.add(`${data[i]},${data[i + 1]},${data[i + 2]}`);
                }
                return seen.size;
            });
            // Sky, ground, tower, gun, helicopter, trooper, shell — many colours.
            expect(colours).toBeGreaterThan(5);
        });

        test('a long frame gap cannot teleport a trooper through the sand', async ({ page }) => {
            const t = await page.evaluate(() => {
                startGame();
                spawnTimer = Number.POSITIVE_INFINITY;
                spawnTrooper(120, 100);
                step(100);
                return { y: troopers[0].y, ground: GROUND_Y };
            });
            expect(t.y).toBeLessThanOrEqual(t.ground);
        });
    });
});
