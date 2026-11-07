const { test, expect } = require('@playwright/test');
const path = require('path');
const { pathToFileURL } = require('url');

const GAME_URL = pathToFileURL(path.resolve(__dirname, '../index.html')).href;

// Start a run and stop the animation loop, so a test can place the world
// exactly how it wants and advance the simulation one fixed step at a time.
async function startFrozen(page) {
    await page.evaluate(() => {
        startGame();
        autoRun = false;
        enemies.length = 0;
        bullets.length = 0;
        enemyBullets.length = 0;
        chutes.length = 0;
        spawnTimer = 999;
        chuteTimer = 999;
    });
}

// Advance the frozen simulation by `steps` fixed timesteps.
async function step(page, steps = 1) {
    await page.evaluate((n) => {
        for (let i = 0; i < n; i++) physicsStep(DT);
    }, steps);
}

// Advance the frozen simulation by a number of seconds.
async function stepSeconds(page, seconds) {
    await page.evaluate((s) => {
        const n = Math.round(s / DT);
        for (let i = 0; i < n; i++) physicsStep(DT);
    }, seconds);
}

const snapshot = (page) =>
    page.evaluate(() => ({
        state,
        score,
        lives,
        wave,
        kills,
        rescued,
        best,
        player: { ...player },
        enemies: enemies.length,
        bullets: bullets.length,
        enemyBullets: enemyBullets.length,
        chutes: chutes.length,
    }));

const consts = (page) =>
    page.evaluate(() => ({
        W,
        H,
        DT,
        PLAYER_SPEED,
        TURN_RATE,
        BULLET_SPEED,
        BULLET_LIFE,
        MAX_BULLETS,
        FIRE_COOLDOWN,
        SPAWN_DIST,
        DESPAWN_DIST,
        RESCUE_POINTS,
        INVULN_TIME,
        BANNER_TIME,
        CHUTE_DRIFT,
        PLAYER_R,
        ENEMY_R,
        CHUTE_R,
        ERAS,
    }));

test.describe('Time Pilot', () => {
    test.beforeEach(async ({ page }) => {
        await page.goto(GAME_URL);
        await page.evaluate(() => localStorage.clear());
        await page.reload();
    });

    // -----------------------------------------------------------------------
    // Page and initial state
    // -----------------------------------------------------------------------
    test.describe('initial state', () => {
        test('page title is Time Pilot', async ({ page }) => {
            await expect(page).toHaveTitle('Time Pilot');
        });

        test('canvas is 640x640', async ({ page }) => {
            const canvas = page.locator('#canvas');
            await expect(canvas).toHaveAttribute('width', '640');
            await expect(canvas).toHaveAttribute('height', '640');
        });

        test('start overlay is visible and prompts the player', async ({ page }) => {
            await expect(page.locator('#overlay')).toHaveClass(/visible/);
            await expect(page.locator('#overlay-sub')).toContainText(/space|start/i);
        });

        test('HUD shows starting values', async ({ page }) => {
            await expect(page.locator('#score')).toHaveText('0');
            await expect(page.locator('#wave')).toHaveText('1');
            await expect(page.locator('#year')).toHaveText('1910');
            await expect(page.locator('#lives')).toHaveText('3');
            await expect(page.locator('#best')).toHaveText('0');
        });

        test('game is idle with an empty battlefield', async ({ page }) => {
            const s = await snapshot(page);
            expect(s.state).toBe('idle');
            expect(s.score).toBe(0);
            expect(s.enemies).toBe(0);
            expect(s.bullets).toBe(0);
        });

        test('help text documents the controls', async ({ page }) => {
            const help = await page.locator('.help').innerText();
            expect(help).toMatch(/fire/i);
            expect(help).toMatch(/pause/i);
            expect(help).toMatch(/rescue|parachut|pilot/i);
        });

        test('there are five eras with rising quotas and points', async ({ page }) => {
            const { ERAS } = await consts(page);
            expect(ERAS).toHaveLength(5);
            expect(ERAS.map((e) => e.year)).toEqual([1910, 1940, 1970, 1983, 2001]);
            for (let i = 1; i < ERAS.length; i++) {
                expect(ERAS[i].quota).toBeGreaterThan(ERAS[i - 1].quota);
                expect(ERAS[i].points).toBeGreaterThan(ERAS[i - 1].points);
                expect(ERAS[i].speed).toBeGreaterThan(ERAS[i - 1].speed);
            }
        });
    });

    // -----------------------------------------------------------------------
    // Starting, pausing, restarting
    // -----------------------------------------------------------------------
    test.describe('game lifecycle', () => {
        test('space starts the game and hides the overlay', async ({ page }) => {
            await page.keyboard.press('Space');
            await expect(page.locator('#overlay')).not.toHaveClass(/visible/);
            expect((await snapshot(page)).state).toBe('running');
        });

        test('the start button starts the game', async ({ page }) => {
            await page.locator('#btn-start').click();
            expect((await snapshot(page)).state).toBe('running');
        });

        test('a fresh run starts with three lives at wave 1', async ({ page }) => {
            await startFrozen(page);
            const s = await snapshot(page);
            expect(s.lives).toBe(3);
            expect(s.wave).toBe(1);
            expect(s.kills).toBe(0);
            expect(s.score).toBe(0);
        });

        test('the plane starts in the middle of the world pointing up', async ({ page }) => {
            await startFrozen(page);
            const s = await snapshot(page);
            expect(s.player.heading).toBeCloseTo(-Math.PI / 2, 5);
        });

        test('P pauses and resumes', async ({ page }) => {
            await page.keyboard.press('Space');
            await page.keyboard.press('KeyP');
            expect((await snapshot(page)).state).toBe('paused');
            await page.keyboard.press('KeyP');
            expect((await snapshot(page)).state).toBe('running');
        });

        test('a paused game does not advance', async ({ page }) => {
            await page.keyboard.press('Space');
            await page.keyboard.press('KeyP');
            const before = (await snapshot(page)).player;
            await page.waitForTimeout(300);
            const after = (await snapshot(page)).player;
            expect(after.x).toBeCloseTo(before.x, 5);
            expect(after.y).toBeCloseTo(before.y, 5);
        });

        test('a running game does advance on its own', async ({ page }) => {
            await page.keyboard.press('Space');
            const before = (await snapshot(page)).player;
            await page.waitForTimeout(300);
            const after = (await snapshot(page)).player;
            expect(Math.abs(after.y - before.y)).toBeGreaterThan(10);
        });

        test('space restarts after a game over', async ({ page }) => {
            await startFrozen(page);
            await page.evaluate(() => {
                score = 777;
                lives = 1;
                player.invuln = 0;
                enemyBullets.push({ x: player.x, y: player.y, vx: 0, vy: 0, age: 0 });
            });
            await step(page, 1);
            expect((await snapshot(page)).state).toBe('gameover');
            await page.keyboard.press('Space');
            const s = await snapshot(page);
            expect(s.state).toBe('running');
            expect(s.score).toBe(0);
            expect(s.lives).toBe(3);
        });
    });

    // -----------------------------------------------------------------------
    // Flight model
    // -----------------------------------------------------------------------
    test.describe('flight', () => {
        test('the plane flies forward along its heading', async ({ page }) => {
            await startFrozen(page);
            const { PLAYER_SPEED, DT } = await consts(page);
            const before = (await snapshot(page)).player;
            await step(page, 60);
            const after = (await snapshot(page)).player;
            expect(after.x).toBeCloseTo(before.x, 3);
            expect(after.y).toBeCloseTo(before.y - PLAYER_SPEED * 60 * DT, 3);
        });

        test('the plane never stops moving', async ({ page }) => {
            await startFrozen(page);
            const a = (await snapshot(page)).player;
            await step(page, 10);
            const b = (await snapshot(page)).player;
            expect(Math.hypot(b.x - a.x, b.y - a.y)).toBeGreaterThan(0);
        });

        test('left turns counter-clockwise at the documented rate', async ({ page }) => {
            await startFrozen(page);
            const { TURN_RATE, DT } = await consts(page);
            const before = (await snapshot(page)).player.heading;
            await page.keyboard.down('ArrowLeft');
            await step(page, 30);
            await page.keyboard.up('ArrowLeft');
            const after = (await snapshot(page)).player.heading;
            expect(after).toBeCloseTo(before - TURN_RATE * 30 * DT, 3);
        });

        test('right turns clockwise', async ({ page }) => {
            await startFrozen(page);
            const { TURN_RATE, DT } = await consts(page);
            const before = (await snapshot(page)).player.heading;
            await page.keyboard.down('ArrowRight');
            await step(page, 30);
            await page.keyboard.up('ArrowRight');
            const after = (await snapshot(page)).player.heading;
            expect(after).toBeCloseTo(before + TURN_RATE * 30 * DT, 3);
        });

        test('A and D also steer', async ({ page }) => {
            await startFrozen(page);
            const start = (await snapshot(page)).player.heading;
            await page.keyboard.down('KeyA');
            await step(page, 20);
            await page.keyboard.up('KeyA');
            const left = (await snapshot(page)).player.heading;
            expect(left).toBeLessThan(start);

            await page.keyboard.down('KeyD');
            await step(page, 40);
            await page.keyboard.up('KeyD');
            const right = (await snapshot(page)).player.heading;
            expect(right).toBeGreaterThan(left);
        });

        test('a full turn changes the direction of travel', async ({ page }) => {
            await startFrozen(page);
            await page.keyboard.down('ArrowRight');
            await stepSeconds(page, Math.PI / 2 / 2.6); // a quarter turn, to due east
            await page.keyboard.up('ArrowRight');
            const before = (await snapshot(page)).player;
            await step(page, 60);
            const after = (await snapshot(page)).player;
            expect(Math.abs(after.x - before.x)).toBeGreaterThan(20);
        });

        test('heading stays normalized through many turns', async ({ page }) => {
            await startFrozen(page);
            await page.keyboard.down('ArrowRight');
            await stepSeconds(page, 10);
            await page.keyboard.up('ArrowRight');
            const h = (await snapshot(page)).player.heading;
            expect(h).toBeGreaterThanOrEqual(-Math.PI - 1e-6);
            expect(h).toBeLessThanOrEqual(Math.PI + 1e-6);
        });
    });

    // -----------------------------------------------------------------------
    // Guns
    // -----------------------------------------------------------------------
    test.describe('firing', () => {
        test('fire launches a bullet along the heading', async ({ page }) => {
            await startFrozen(page);
            const { BULLET_SPEED } = await consts(page);
            const b = await page.evaluate(() => {
                fire();
                return bullets[0] ? { ...bullets[0] } : null;
            });
            expect(b).not.toBeNull();
            expect(b.vy).toBeCloseTo(-BULLET_SPEED, 3);
            expect(b.vx).toBeCloseTo(0, 3);
        });

        test('bullets start at the nose, ahead of the plane', async ({ page }) => {
            await startFrozen(page);
            const { x, y, bx, by } = await page.evaluate(() => {
                fire();
                return { x: player.x, y: player.y, bx: bullets[0].x, by: bullets[0].y };
            });
            expect(by).toBeLessThan(y);
            expect(bx).toBeCloseTo(x, 3);
        });

        test('the gun has a cooldown', async ({ page }) => {
            await startFrozen(page);
            await page.evaluate(() => {
                fire();
                fire();
                fire();
            });
            expect((await snapshot(page)).bullets).toBe(1);
        });

        test('the gun fires again once the cooldown expires', async ({ page }) => {
            await startFrozen(page);
            const { FIRE_COOLDOWN } = await consts(page);
            await page.evaluate(() => fire());
            await stepSeconds(page, FIRE_COOLDOWN + 0.01);
            await page.evaluate(() => fire());
            expect((await snapshot(page)).bullets).toBe(2);
        });

        test('no more than MAX_BULLETS are in flight', async ({ page }) => {
            await startFrozen(page);
            const { MAX_BULLETS, FIRE_COOLDOWN, DT } = await consts(page);
            await page.evaluate(
                ({ cooldown, dt }) => {
                    for (let i = 0; i < 20; i++) {
                        fire();
                        const n = Math.round((cooldown + dt) / dt);
                        for (let k = 0; k < n; k++) physicsStep(dt);
                    }
                },
                { cooldown: FIRE_COOLDOWN, dt: DT },
            );
            expect((await snapshot(page)).bullets).toBeLessThanOrEqual(MAX_BULLETS);
        });

        test('bullets travel at BULLET_SPEED', async ({ page }) => {
            await startFrozen(page);
            const { BULLET_SPEED, DT } = await consts(page);
            const moved = await page.evaluate(
                ({ dt }) => {
                    fire();
                    const y0 = bullets[0].y;
                    for (let i = 0; i < 30; i++) physicsStep(dt);
                    return bullets[0] ? y0 - bullets[0].y : null;
                },
                { dt: DT },
            );
            expect(moved).toBeCloseTo(BULLET_SPEED * 30 * DT, 2);
        });

        test('bullets expire after BULLET_LIFE', async ({ page }) => {
            await startFrozen(page);
            const { BULLET_LIFE } = await consts(page);
            await page.evaluate(() => fire());
            expect((await snapshot(page)).bullets).toBe(1);
            await stepSeconds(page, BULLET_LIFE + 0.05);
            expect((await snapshot(page)).bullets).toBe(0);
        });

        test('space fires while running', async ({ page }) => {
            await startFrozen(page);
            await page.keyboard.press('Space');
            await step(page, 1);
            expect((await snapshot(page)).bullets).toBeGreaterThan(0);
        });

        test('clicking the canvas fires', async ({ page }) => {
            await startFrozen(page);
            await page.locator('#canvas').click({ position: { x: 100, y: 100 } });
            expect((await snapshot(page)).bullets).toBeGreaterThan(0);
        });

        test('firing does nothing when the game is not running', async ({ page }) => {
            await page.evaluate(() => fire());
            expect((await snapshot(page)).bullets).toBe(0);
        });
    });

    // -----------------------------------------------------------------------
    // Enemies
    // -----------------------------------------------------------------------
    test.describe('enemies', () => {
        test('enemies spawn on the ring, off screen', async ({ page }) => {
            await startFrozen(page);
            const { SPAWN_DIST, W } = await consts(page);
            const d = await page.evaluate(() => {
                spawnEnemy();
                const e = enemies[0];
                return Math.hypot(e.x - player.x, e.y - player.y);
            });
            expect(d).toBeCloseTo(SPAWN_DIST, 2);
            expect(SPAWN_DIST).toBeGreaterThan(W / 2);
        });

        test('enemies arrive on their own while the game runs', async ({ page }) => {
            await page.evaluate(() => {
                startGame();
                autoRun = false;
            });
            await stepSeconds(page, 3);
            expect((await snapshot(page)).enemies).toBeGreaterThan(0);
        });

        test('no more than the era cap are alive at once', async ({ page }) => {
            await page.evaluate(() => {
                startGame();
                autoRun = false;
                player.invuln = 9999;
            });
            await stepSeconds(page, 20);
            const { alive, cap } = await page.evaluate(() => ({
                alive: enemies.length,
                cap: era().maxAlive,
            }));
            expect(alive).toBeLessThanOrEqual(cap);
        });

        test('an enemy facing away swings round toward the player', async ({ page }) => {
            await startFrozen(page);
            // Heading 0 is straight away from a player sitting 300px to the west,
            // so the aim error starts at pi and has nowhere to go but down.
            const before = await page.evaluate(() => {
                player.invuln = 9999;
                enemies.push({ x: player.x + 300, y: player.y, heading: 0, cool: 99 });
                return aimError(enemies[0]);
            });
            await stepSeconds(page, 0.5);
            const after = await page.evaluate(() => aimError(enemies[0]));
            expect(before).toBeCloseTo(Math.PI, 2);
            expect(after).toBeLessThan(before - 0.5);
        });

        test('enemies close the distance on a player holding a turn', async ({ page }) => {
            await startFrozen(page);
            // Holding a turn key flies the plane in a tight circle, which keeps it
            // in roughly one place while the enemy comes to it.
            const before = await page.evaluate(() => {
                player.invuln = 9999;
                enemies.push({ x: player.x + 300, y: player.y, heading: 0, cool: 99 });
                return Math.hypot(enemies[0].x - player.x, enemies[0].y - player.y);
            });
            await page.keyboard.down('ArrowRight');
            await stepSeconds(page, 4);
            await page.keyboard.up('ArrowRight');
            const after = await page.evaluate(() =>
                enemies.length ? Math.hypot(enemies[0].x - player.x, enemies[0].y - player.y) : 0,
            );
            expect(after).toBeLessThan(before - 50);
        });

        test('enemies turn, rather than snapping, toward the player', async ({ page }) => {
            await startFrozen(page);
            await page.evaluate(() => {
                player.invuln = 9999;
                enemies.push({ x: player.x + 300, y: player.y, heading: 0, cool: 99 });
            });
            await step(page, 1);
            const h = await page.evaluate(() => enemies[0].heading);
            expect(Math.abs(h)).toBeLessThan(Math.PI); // did not teleport its heading
            expect(Math.abs(h)).toBeGreaterThan(0); // but did start turning
        });

        test('enemies that wander too far away are removed', async ({ page }) => {
            await startFrozen(page);
            await page.evaluate(() => {
                enemies.push({ x: player.x + DESPAWN_DIST + 80, y: player.y, heading: 0, cool: 99 });
            });
            await step(page, 1);
            expect((await snapshot(page)).enemies).toBe(0);
        });

        test('enemies move at their era speed', async ({ page }) => {
            await startFrozen(page);
            const { DT } = await consts(page);
            const { moved, expected } = await page.evaluate(
                ({ dt }) => {
                    player.invuln = 9999;
                    enemies.push({ x: player.x + 300, y: player.y, heading: 0, cool: 99 });
                    const e = enemies[0];
                    const x0 = e.x;
                    const y0 = e.y;
                    physicsStep(dt);
                    return {
                        moved: Math.hypot(e.x - x0, e.y - y0),
                        expected: enemySpeed() * dt,
                    };
                },
                { dt: DT },
            );
            expect(moved).toBeCloseTo(expected, 4);
        });

        test('enemies can shoot at the player', async ({ page }) => {
            await startFrozen(page);
            const b = await page.evaluate(() => {
                const e = { x: player.x + 200, y: player.y, heading: Math.PI, cool: 0 };
                enemies.push(e);
                fireEnemyBullet(e);
                return enemyBullets[0] ? { ...enemyBullets[0] } : null;
            });
            expect(b).not.toBeNull();
            expect(b.vx).toBeLessThan(0); // aimed back at the player
        });

        test('enemy bullets are slower than the player’s', async ({ page }) => {
            const { ENEMY_BULLET_SPEED, BULLET_SPEED } = await page.evaluate(() => ({
                ENEMY_BULLET_SPEED,
                BULLET_SPEED,
            }));
            expect(ENEMY_BULLET_SPEED).toBeLessThan(BULLET_SPEED);
        });

        test('enemy bullets appear during a real dogfight', async ({ page }) => {
            await page.evaluate(() => {
                seedRng(12345);
                startGame();
                autoRun = false;
                player.invuln = 9999;
            });
            await stepSeconds(page, 25);
            expect((await snapshot(page)).enemyBullets).toBeGreaterThan(0);
        });

        test('enemy bullets expire', async ({ page }) => {
            await startFrozen(page);
            await page.evaluate(() => {
                player.invuln = 9999;
                enemyBullets.push({ x: player.x + 400, y: player.y + 400, vx: 0, vy: 0, age: 0 });
            });
            await stepSeconds(page, 5);
            expect((await snapshot(page)).enemyBullets).toBe(0);
        });
    });

    // -----------------------------------------------------------------------
    // Shooting enemies down
    // -----------------------------------------------------------------------
    test.describe('kills and waves', () => {
        test('a bullet on an enemy destroys it and scores', async ({ page }) => {
            await startFrozen(page);
            const points = await page.evaluate(() => {
                player.invuln = 9999;
                const e = { x: player.x + 200, y: player.y, heading: 0, cool: 99 };
                enemies.push(e);
                bullets.push({ x: e.x, y: e.y, vx: 0, vy: 0, age: 0 });
                return era().points;
            });
            await step(page, 1);
            const s = await snapshot(page);
            expect(s.enemies).toBe(0);
            expect(s.bullets).toBe(0);
            expect(s.score).toBe(points);
            expect(s.kills).toBe(1);
        });

        test('a bullet that misses leaves the enemy alone', async ({ page }) => {
            await startFrozen(page);
            await page.evaluate(() => {
                player.invuln = 9999;
                const e = { x: player.x + 200, y: player.y, heading: 0, cool: 99 };
                enemies.push(e);
                bullets.push({ x: e.x, y: e.y - 120, vx: 0, vy: 0, age: 0 });
            });
            await step(page, 1);
            const s = await snapshot(page);
            expect(s.enemies).toBe(1);
            expect(s.score).toBe(0);
        });

        test('filling the quota advances the era', async ({ page }) => {
            await startFrozen(page);
            await page.evaluate(() => {
                player.invuln = 9999;
                kills = era().quota - 1;
                const e = { x: player.x + 200, y: player.y, heading: 0, cool: 99 };
                enemies.push(e);
                bullets.push({ x: e.x, y: e.y, vx: 0, vy: 0, age: 0 });
            });
            await step(page, 1);
            const s = await snapshot(page);
            expect(s.wave).toBe(2);
            expect(s.kills).toBe(0);
            await expect(page.locator('#year')).toHaveText('1940');
            await expect(page.locator('#wave')).toHaveText('2');
        });

        test('an era change announces itself and clears enemy fire', async ({ page }) => {
            await startFrozen(page);
            await page.evaluate(() => {
                player.invuln = 9999;
                enemyBullets.push({ x: player.x + 300, y: player.y, vx: 0, vy: 0, age: 0 });
                kills = era().quota - 1;
                const e = { x: player.x + 200, y: player.y, heading: 0, cool: 99 };
                enemies.push(e);
                bullets.push({ x: e.x, y: e.y, vx: 0, vy: 0, age: 0 });
            });
            await step(page, 1);
            const s = await snapshot(page);
            expect(s.enemyBullets).toBe(0);
            const b = await page.evaluate(() => ({ text: banner.text, time: banner.time }));
            expect(b.time).toBeGreaterThan(0);
            expect(b.text).toMatch(/1940/);
        });

        test('the era cycle wraps around and gets harder', async ({ page }) => {
            await startFrozen(page);
            const { base, cycled } = await page.evaluate(() => {
                wave = 1;
                const base = enemySpeed();
                wave = 6;
                return { base, cycled: enemySpeed() };
            });
            expect(await page.evaluate(() => era().year)).toBe(1910);
            expect(cycled).toBeGreaterThan(base);
        });

        test('each era is faster than the last within a cycle', async ({ page }) => {
            const speeds = await page.evaluate(() => {
                const out = [];
                for (let w = 1; w <= 5; w++) {
                    wave = w;
                    out.push(enemySpeed());
                }
                wave = 1;
                return out;
            });
            for (let i = 1; i < speeds.length; i++) {
                expect(speeds[i]).toBeGreaterThan(speeds[i - 1]);
            }
        });
    });

    // -----------------------------------------------------------------------
    // Damage
    // -----------------------------------------------------------------------
    test.describe('damage', () => {
        test('an enemy bullet costs a life', async ({ page }) => {
            await startFrozen(page);
            await page.evaluate(() => {
                player.invuln = 0;
                enemyBullets.push({ x: player.x, y: player.y, vx: 0, vy: 0, age: 0 });
            });
            await step(page, 1);
            const s = await snapshot(page);
            expect(s.lives).toBe(2);
            expect(s.enemyBullets).toBe(0);
            await expect(page.locator('#lives')).toHaveText('2');
        });

        test('a hit grants temporary invulnerability', async ({ page }) => {
            await startFrozen(page);
            const { INVULN_TIME } = await consts(page);
            await page.evaluate(() => {
                player.invuln = 0;
                enemyBullets.push({ x: player.x, y: player.y, vx: 0, vy: 0, age: 0 });
            });
            await step(page, 1);
            const invuln = await page.evaluate(() => player.invuln);
            expect(invuln).toBeGreaterThan(INVULN_TIME - 0.2);
        });

        test('an invulnerable plane shrugs off bullets', async ({ page }) => {
            await startFrozen(page);
            await page.evaluate(() => {
                player.invuln = 5;
                enemyBullets.push({ x: player.x, y: player.y, vx: 0, vy: 0, age: 0 });
            });
            await step(page, 1);
            expect((await snapshot(page)).lives).toBe(3);
        });

        test('invulnerability wears off', async ({ page }) => {
            await startFrozen(page);
            await page.evaluate(() => {
                player.invuln = 0.1;
            });
            await stepSeconds(page, 0.5);
            expect(await page.evaluate(() => player.invuln)).toBeLessThanOrEqual(0);
        });

        test('ramming an enemy costs a life and takes the enemy with it', async ({ page }) => {
            await startFrozen(page);
            await page.evaluate(() => {
                player.invuln = 0;
                enemies.push({ x: player.x, y: player.y, heading: 0, cool: 99 });
            });
            await step(page, 1);
            const s = await snapshot(page);
            expect(s.lives).toBe(2);
            expect(s.enemies).toBe(0);
        });

        test('losing the last life ends the game', async ({ page }) => {
            await startFrozen(page);
            await page.evaluate(() => {
                lives = 1;
                player.invuln = 0;
                enemyBullets.push({ x: player.x, y: player.y, vx: 0, vy: 0, age: 0 });
            });
            await step(page, 1);
            const s = await snapshot(page);
            expect(s.state).toBe('gameover');
            expect(s.lives).toBe(0);
            await expect(page.locator('#overlay')).toHaveClass(/visible/);
            await expect(page.locator('#overlay-title')).toContainText(/over/i);
        });

        test('the game over overlay reports the score', async ({ page }) => {
            await startFrozen(page);
            await page.evaluate(() => {
                score = 4200;
                lives = 1;
                player.invuln = 0;
                enemyBullets.push({ x: player.x, y: player.y, vx: 0, vy: 0, age: 0 });
            });
            await step(page, 1);
            await expect(page.locator('#overlay-score')).toContainText('4200');
        });

        test('nothing moves after a game over', async ({ page }) => {
            await startFrozen(page);
            await page.evaluate(() => {
                lives = 1;
                player.invuln = 0;
                enemyBullets.push({ x: player.x, y: player.y, vx: 0, vy: 0, age: 0 });
            });
            await step(page, 1);
            const before = (await snapshot(page)).player;
            await step(page, 60);
            const after = (await snapshot(page)).player;
            expect(after.x).toBeCloseTo(before.x, 5);
            expect(after.y).toBeCloseTo(before.y, 5);
        });
    });

    // -----------------------------------------------------------------------
    // Parachute rescues
    // -----------------------------------------------------------------------
    test.describe('rescues', () => {
        test('flying into a parachute scores the rescue bonus', async ({ page }) => {
            await startFrozen(page);
            const { RESCUE_POINTS } = await consts(page);
            await page.evaluate(() => {
                chutes.push({ x: player.x, y: player.y, age: 0 });
            });
            await step(page, 1);
            const s = await snapshot(page);
            expect(s.score).toBe(RESCUE_POINTS);
            expect(s.rescued).toBe(1);
            expect(s.chutes).toBe(0);
        });

        test('a rescue is worth more than any kill', async ({ page }) => {
            const { RESCUE_POINTS, ERAS } = await consts(page);
            const best = Math.max(...ERAS.map((e) => e.points));
            expect(RESCUE_POINTS).toBeGreaterThan(best);
        });

        test('parachutes drift downward', async ({ page }) => {
            await startFrozen(page);
            const { CHUTE_DRIFT } = await consts(page);
            const moved = await page.evaluate(() => {
                const c = { x: player.x + 300, y: player.y + 300, age: 0 };
                chutes.push(c);
                const y0 = c.y;
                for (let i = 0; i < 120; i++) physicsStep(DT);
                return chutes.length ? chutes[0].y - y0 : null;
            });
            expect(moved).toBeCloseTo(CHUTE_DRIFT, 1);
        });

        test('parachutes are harmless', async ({ page }) => {
            await startFrozen(page);
            await page.evaluate(() => {
                player.invuln = 0;
                chutes.push({ x: player.x, y: player.y, age: 0 });
            });
            await step(page, 1);
            expect((await snapshot(page)).lives).toBe(3);
        });

        test('parachutes appear on their own during play', async ({ page }) => {
            await page.evaluate(() => {
                startGame();
                autoRun = false;
                player.invuln = 9999;
            });
            await stepSeconds(page, 6);
            const seen = await page.evaluate(() => chutes.length + rescued);
            expect(seen).toBeGreaterThan(0);
        });

        test('no more than MAX_CHUTES drift at once', async ({ page }) => {
            await page.evaluate(() => {
                startGame();
                autoRun = false;
                player.invuln = 9999;
            });
            await stepSeconds(page, 30);
            const { n, cap } = await page.evaluate(() => ({ n: chutes.length, cap: MAX_CHUTES }));
            expect(n).toBeLessThanOrEqual(cap);
        });
    });

    // -----------------------------------------------------------------------
    // Score keeping
    // -----------------------------------------------------------------------
    test.describe('scoring', () => {
        test('the HUD tracks the score', async ({ page }) => {
            await startFrozen(page);
            await page.evaluate(() => {
                chutes.push({ x: player.x, y: player.y, age: 0 });
            });
            await step(page, 1);
            await expect(page.locator('#score')).toHaveText('1000');
        });

        test('the best score is remembered across reloads', async ({ page }) => {
            await startFrozen(page);
            await page.evaluate(() => {
                score = 3300;
                lives = 1;
                player.invuln = 0;
                enemyBullets.push({ x: player.x, y: player.y, vx: 0, vy: 0, age: 0 });
            });
            await step(page, 1);
            await expect(page.locator('#best')).toHaveText('3300');
            await page.reload();
            await expect(page.locator('#best')).toHaveText('3300');
        });

        test('a worse run does not lower the best score', async ({ page }) => {
            await page.evaluate(() => localStorage.setItem('timepilot-best', '9000'));
            await page.reload();
            await startFrozen(page);
            await page.evaluate(() => {
                score = 10;
                lives = 1;
                player.invuln = 0;
                enemyBullets.push({ x: player.x, y: player.y, vx: 0, vy: 0, age: 0 });
            });
            await step(page, 1);
            await expect(page.locator('#best')).toHaveText('9000');
        });
    });

    // -----------------------------------------------------------------------
    // Rendering and robustness
    // -----------------------------------------------------------------------
    test.describe('rendering', () => {
        test('the canvas is painted', async ({ page }) => {
            await page.keyboard.press('Space');
            await page.waitForTimeout(400);
            const ink = await page.evaluate(() => {
                const data = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height)
                    .data;
                let n = 0;
                for (let i = 0; i < data.length; i += 4) {
                    if (data[i] > 40 || data[i + 1] > 40 || data[i + 2] > 60) n++;
                }
                return n;
            });
            expect(ink).toBeGreaterThan(500);
        });

        test('the plane is drawn in the middle of the screen', async ({ page }) => {
            await page.keyboard.press('Space');
            await page.waitForTimeout(200);
            const { cx, cy, W, H } = await page.evaluate(() => ({
                cx: screenX(player.x),
                cy: screenY(player.y),
                W,
                H,
            }));
            expect(cx).toBeCloseTo(W / 2, 5);
            expect(cy).toBeCloseTo(H / 2, 5);
        });

        test('a minute of play raises no console errors', async ({ page }) => {
            const errors = [];
            page.on('pageerror', (e) => errors.push(String(e)));
            page.on('console', (m) => {
                if (m.type() === 'error') errors.push(m.text());
            });
            await page.keyboard.press('Space');
            await page.evaluate(() => {
                autoRun = false;
                seedRng(99);
                for (let i = 0; i < 60 * 120; i++) physicsStep(DT);
                draw();
            });
            await page.waitForTimeout(100);
            expect(errors).toEqual([]);
        });

        test('a long unattended run stays finite and bounded', async ({ page }) => {
            await page.evaluate(() => {
                seedRng(7);
                startGame();
                autoRun = false;
                player.invuln = 9999;
                for (let i = 0; i < 60 * 120; i++) physicsStep(DT);
            });
            const s = await page.evaluate(() => ({
                x: player.x,
                y: player.y,
                enemies: enemies.length,
                bullets: bullets.length,
                enemyBullets: enemyBullets.length,
                chutes: chutes.length,
                score,
            }));
            expect(Number.isFinite(s.x)).toBe(true);
            expect(Number.isFinite(s.y)).toBe(true);
            expect(s.enemies).toBeLessThan(20);
            expect(s.enemyBullets).toBeLessThan(200);
            expect(s.chutes).toBeLessThanOrEqual(3);
            expect(s.score).toBeGreaterThanOrEqual(0);
        });
    });
});
