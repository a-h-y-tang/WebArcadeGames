const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');

const GAME_URL = pathToFileURL(path.resolve(__dirname, '../index.html')).href;
const REPO_ROOT = path.resolve(__dirname, '../..');

// Start a level and freeze the animation loop so a test can pose the building
// itself and advance the simulation one deterministic step at a time.
async function start(page, { enemies = false } = {}) {
    await page.evaluate((spawn) => {
        startGame();
        autoRun = false;
        spawnEnabled = spawn;
    }, enemies);
}

// Advance the frozen simulation by `steps` fixed timesteps.
async function step(page, steps = 1) {
    await page.evaluate((n) => {
        for (let i = 0; i < n; i++) physicsStep(1 / 120);
    }, steps);
}

// Hold or release a key the way the player would.
async function hold(page, code, down = true) {
    await page.evaluate(([c, d]) => { keys[c] = d; }, [code, down]);
}

// Hold a key for a number of steps, then release it.
async function holdFor(page, code, steps) {
    await hold(page, code);
    await step(page, steps);
    await hold(page, code, false);
}

async function player(page) {
    return page.evaluate(() => ({
        x: player.x, y: player.y, facing: player.facing,
        ducking: player.ducking, alive: player.alive,
        support: player.support,
    }));
}

async function place(page, floor, x) {
    await page.evaluate(([f, px]) => { placePlayerOnFloor(f, px); }, [floor, x]);
}

// Park both cars on a given floor so a test knows where they are.
async function parkCars(page, floor) {
    await page.evaluate((f) => {
        elevators.forEach((e) => { e.y = floorY(f); e.vy = 0; });
    }, floor);
}

test.describe('Elevator Action', () => {
    test.beforeEach(async ({ page }) => {
        await page.goto(GAME_URL);
    });

    // -----------------------------------------------------------------------
    // Initial / idle state
    // -----------------------------------------------------------------------
    test.describe('initial state', () => {
        test('page title is Elevator Action', async ({ page }) => {
            await expect(page).toHaveTitle('Elevator Action');
        });

        test('canvas is 640x600', async ({ page }) => {
            const canvas = page.locator('#canvas');
            await expect(canvas).toHaveAttribute('width', '640');
            await expect(canvas).toHaveAttribute('height', '600');
        });

        test('start overlay is visible and prompts the player', async ({ page }) => {
            await expect(page.locator('#overlay')).toHaveClass(/visible/);
            await expect(page.locator('#overlay-sub')).toContainText(/space|start/i);
        });

        test('HUD shows starting values', async ({ page }) => {
            await expect(page.locator('#score')).toHaveText('0');
            await expect(page.locator('#level')).toHaveText('1');
            await expect(page.locator('#lives')).toHaveText('3');
            await expect(page.locator('#best')).toHaveText('0');
        });

        test('state is idle and the building is empty before starting', async ({ page }) => {
            expect(await page.evaluate(() => state)).toBe('idle');
            expect(await page.evaluate(() => enemies.length)).toBe(0);
            expect(await page.evaluate(() => bullets.length)).toBe(0);
        });

        test('help text names the controls', async ({ page }) => {
            const help = await page.locator('.help').innerText();
            expect(help.toLowerCase()).toMatch(/elevator|duck|shoot/);
        });
    });

    // -----------------------------------------------------------------------
    // Building geometry
    // -----------------------------------------------------------------------
    test.describe('building layout', () => {
        test('there are seven evenly spaced floors', async ({ page }) => {
            const { ys, gap } = await page.evaluate(() => ({
                ys: Array.from({ length: FLOOR_COUNT }, (_, i) => floorY(i)),
                gap: FLOOR_H,
            }));
            expect(ys).toHaveLength(7);
            for (let i = 1; i < ys.length; i++) {
                expect(ys[i] - ys[i - 1]).toBe(gap);
            }
            expect(ys[ys.length - 1]).toBeLessThan(600);
        });

        test('two elevator shafts split every floor into three walkways', async ({ page }) => {
            expect(await page.evaluate(() => SHAFTS.length)).toBe(2);
            const segs = await page.evaluate(() => [
                segmentFor(60), segmentFor(330), segmentFor(560),
            ]);
            expect(segs[0]).toEqual({ left: 24, right: 192 });
            expect(segs[1]).toEqual({ left: 256, right: 408 });
            expect(segs[2]).toEqual({ left: 472, right: 616 });
        });

        test('both cars start level with the roof floor', async ({ page }) => {
            await start(page);
            const ys = await page.evaluate(() => elevators.map((e) => e.y));
            expect(ys).toEqual([await page.evaluate(() => floorY(0)),
                await page.evaluate(() => floorY(0))]);
        });

        test('every office floor carries three doors and the garage none', async ({ page }) => {
            await start(page);
            const perFloor = await page.evaluate(() => {
                const counts = Array(FLOOR_COUNT).fill(0);
                doors.forEach((d) => counts[d.floor]++);
                return counts;
            });
            expect(perFloor).toEqual([3, 3, 3, 3, 3, 3, 0]);
        });

        test('no door stands over a shaft', async ({ page }) => {
            await start(page);
            const overlapping = await page.evaluate(() =>
                doors.filter((d) =>
                    SHAFTS.some((sx) => d.x + DOOR_W / 2 > sx && d.x - DOOR_W / 2 < sx + CAR_W)
                ).length);
            expect(overlapping).toBe(0);
        });

        test('level 1 hides four documents behind red doors', async ({ page }) => {
            await start(page);
            expect(await page.evaluate(() => doors.filter((d) => d.red).length)).toBe(4);
            expect(await page.evaluate(() => docsLeft())).toBe(4);
            await expect(page.locator('#docs')).toHaveText('4');
        });

        test('the layout is identical every time level 1 is built', async ({ page }) => {
            const first = await page.evaluate(() => { startGame(); return JSON.stringify(doors); });
            const second = await page.evaluate(() => { startGame(); return JSON.stringify(doors); });
            expect(second).toBe(first);
        });

        test('later levels ask for more documents, capped at six', async ({ page }) => {
            const counts = await page.evaluate(() => {
                const out = [];
                for (let l = 1; l <= 6; l++) {
                    level = l;
                    buildLevel(l);
                    out.push(doors.filter((d) => d.red).length);
                }
                return out;
            });
            expect(counts).toEqual([4, 5, 6, 6, 6, 6]);
        });
    });

    // -----------------------------------------------------------------------
    // Starting a game
    // -----------------------------------------------------------------------
    test.describe('starting', () => {
        test('pressing Space starts the game and hides the overlay', async ({ page }) => {
            await page.keyboard.press('Space');
            expect(await page.evaluate(() => state)).toBe('running');
            await expect(page.locator('#overlay')).not.toHaveClass(/visible/);
        });

        test('the start button starts the game too', async ({ page }) => {
            await page.locator('#btn-start').click();
            expect(await page.evaluate(() => state)).toBe('running');
        });

        test('the spy starts on the roof floor facing left', async ({ page }) => {
            await start(page);
            const p = await player(page);
            expect(p.y).toBe(await page.evaluate(() => floorY(0)));
            expect(p.support).toEqual({ type: 'floor', index: 0 });
            expect(p.facing).toBe(-1);
            expect(p.alive).toBe(true);
        });

        test('the spy does not start standing in a doorway', async ({ page }) => {
            await start(page);
            const inDoor = await page.evaluate(() =>
                doors.some((d) => d.floor === 0 &&
                    Math.abs(d.x - player.x) < DOOR_W / 2 + PLAYER_W / 2));
            expect(inDoor).toBe(false);
        });

        test('a fresh game resets score, lives and level', async ({ page }) => {
            await page.evaluate(() => { score = 900; lives = 1; level = 4; startGame(); });
            expect(await page.evaluate(() => ({ score, lives, level })))
                .toEqual({ score: 0, lives: 3, level: 1 });
        });
    });

    // -----------------------------------------------------------------------
    // Walking
    // -----------------------------------------------------------------------
    test.describe('walking', () => {
        test('holding right walks right and faces right', async ({ page }) => {
            await start(page);
            await place(page, 2, 300);
            await holdFor(page, 'ArrowRight', 30);
            const p = await player(page);
            expect(p.x).toBeGreaterThan(300);
            expect(p.facing).toBe(1);
        });

        test('holding left walks left and faces left', async ({ page }) => {
            await start(page);
            await place(page, 2, 300);
            await holdFor(page, 'ArrowLeft', 30);
            const p = await player(page);
            expect(p.x).toBeLessThan(300);
            expect(p.facing).toBe(-1);
        });

        test('A and D work as well as the arrows', async ({ page }) => {
            await start(page);
            await place(page, 2, 300);
            await holdFor(page, 'KeyD', 20);
            const right = (await player(page)).x;
            await holdFor(page, 'KeyA', 40);
            expect(right).toBeGreaterThan(300);
            expect((await player(page)).x).toBeLessThan(right);
        });

        test('walking speed matches WALK_SPEED', async ({ page }) => {
            await start(page);
            await place(page, 2, 300);
            await holdFor(page, 'ArrowRight', 60); // half a second
            const expected = await page.evaluate(() => 300 + WALK_SPEED * 0.5);
            expect((await player(page)).x).toBeCloseTo(expected, 1);
        });

        test('the outer walls stop the spy', async ({ page }) => {
            await start(page);
            await parkCars(page, 2); // so the shafts do not block the walk
            await place(page, 2, 300);
            await holdFor(page, 'ArrowRight', 2000);
            expect((await player(page)).x)
                .toBeCloseTo(await page.evaluate(() => W - MARGIN - PLAYER_W / 2), 3);
            await holdFor(page, 'ArrowLeft', 4000);
            expect((await player(page)).x)
                .toBeCloseTo(await page.evaluate(() => MARGIN + PLAYER_W / 2), 3);
        });

        test('standing still keeps the spy put', async ({ page }) => {
            await start(page);
            await place(page, 3, 330);
            await step(page, 60);
            expect((await player(page)).x).toBe(330);
        });
    });

    // -----------------------------------------------------------------------
    // Shafts as walls
    // -----------------------------------------------------------------------
    test.describe('shafts', () => {
        test('an empty shaft blocks the spy at its edge', async ({ page }) => {
            await start(page);
            await parkCars(page, 0);
            await place(page, 4, 300);
            await holdFor(page, 'ArrowRight', 2000);
            const p = await player(page);
            expect(p.x).toBeCloseTo(await page.evaluate(() => SHAFTS[1] - PLAYER_W / 2), 3);
            expect(p.support).toEqual({ type: 'floor', index: 4 });
        });

        test('an empty shaft blocks the spy from the right too', async ({ page }) => {
            await start(page);
            await parkCars(page, 0);
            await place(page, 4, 300);
            await holdFor(page, 'ArrowLeft', 2000);
            const p = await player(page);
            expect(p.x).toBeCloseTo(await page.evaluate(() => SHAFTS[0] + CAR_W + PLAYER_W / 2), 3);
            expect(p.support).toEqual({ type: 'floor', index: 4 });
        });

        test('a car level with the floor lets the spy board it', async ({ page }) => {
            await start(page);
            await parkCars(page, 4);
            await place(page, 4, 300);
            await holdFor(page, 'ArrowLeft', 60);
            const p = await player(page);
            expect(p.support).toEqual({ type: 'elevator', id: 0 });
            expect(p.x).toBeLessThan(await page.evaluate(() => SHAFTS[0] + CAR_W));
        });

        test('a car a long way off its floor does not let the spy board', async ({ page }) => {
            await start(page);
            await page.evaluate(() => { elevators[0].y = floorY(4) + 40; });
            await place(page, 4, 300);
            await holdFor(page, 'ArrowLeft', 2000);
            expect((await player(page)).support).toEqual({ type: 'floor', index: 4 });
        });

        test('a car slightly off its floor is still close enough to board', async ({ page }) => {
            await start(page);
            await page.evaluate(() => { elevators[0].y = floorY(4) - (ALIGN_EPS - 2); });
            await place(page, 4, 300);
            await holdFor(page, 'ArrowLeft', 60);
            expect((await player(page)).support).toEqual({ type: 'elevator', id: 0 });
        });
    });

    // -----------------------------------------------------------------------
    // Riding the elevators
    // -----------------------------------------------------------------------
    test.describe('elevators', () => {
        test('Down drives the car the spy stands on downwards', async ({ page }) => {
            await start(page);
            await page.evaluate(() => { boardElevator(0, floorY(0)); });
            await holdFor(page, 'ArrowDown', 60);
            const y = await page.evaluate(() => elevators[0].y);
            expect(y).toBeCloseTo(await page.evaluate(() => floorY(0) + CAR_SPEED * 0.5), 1);
            expect((await player(page)).y).toBe(y);
        });

        test('Up drives the car back up', async ({ page }) => {
            await start(page);
            await page.evaluate(() => { boardElevator(0, floorY(3)); });
            await holdFor(page, 'ArrowUp', 60);
            const y = await page.evaluate(() => elevators[0].y);
            expect(y).toBeCloseTo(await page.evaluate(() => floorY(3) - CAR_SPEED * 0.5), 1);
        });

        test('W and S drive the car as well', async ({ page }) => {
            await start(page);
            await page.evaluate(() => { boardElevator(0, floorY(2)); });
            await holdFor(page, 'KeyS', 30);
            const down = await page.evaluate(() => elevators[0].y);
            expect(down).toBeGreaterThan(await page.evaluate(() => floorY(2)));
            await holdFor(page, 'KeyW', 60);
            expect(await page.evaluate(() => elevators[0].y)).toBeLessThan(down);
        });

        test('a car cannot be driven above the roof floor or below the garage', async ({ page }) => {
            await start(page);
            await page.evaluate(() => { boardElevator(0, floorY(0)); });
            await holdFor(page, 'ArrowUp', 600);
            expect(await page.evaluate(() => elevators[0].y)).toBe(await page.evaluate(() => floorY(0)));
            await holdFor(page, 'ArrowDown', 2000);
            expect(await page.evaluate(() => elevators[0].y))
                .toBe(await page.evaluate(() => floorY(FLOOR_COUNT - 1)));
        });

        test('releasing the drive key snaps a nearly-level car onto the floor', async ({ page }) => {
            await start(page);
            await page.evaluate(() => {
                boardElevator(0, floorY(2) - (ALIGN_EPS - 3));
            });
            await step(page, 1);
            expect(await page.evaluate(() => elevators[0].y)).toBe(await page.evaluate(() => floorY(2)));
        });

        test('the other car stays where it was left', async ({ page }) => {
            await start(page);
            await parkCars(page, 0);
            await page.evaluate(() => { boardElevator(0, floorY(0)); });
            await holdFor(page, 'ArrowDown', 200);
            expect(await page.evaluate(() => elevators[1].y)).toBe(await page.evaluate(() => floorY(0)));
        });

        test('stepping off a level car puts the spy on that floor', async ({ page }) => {
            await start(page);
            await page.evaluate(() => { boardElevator(0, floorY(5)); });
            await holdFor(page, 'ArrowRight', 60);
            const p = await player(page);
            expect(p.support).toEqual({ type: 'floor', index: 5 });
            expect(p.y).toBe(await page.evaluate(() => floorY(5)));
        });

        test('a car stopped between floors traps the spy on board', async ({ page }) => {
            await start(page);
            await page.evaluate(() => { boardElevator(0, floorY(3) + 34); });
            await holdFor(page, 'ArrowRight', 200);
            const p = await player(page);
            expect(p.support).toEqual({ type: 'elevator', id: 0 });
            expect(p.x).toBeLessThanOrEqual(await page.evaluate(() => SHAFTS[0] + CAR_W));
            await holdFor(page, 'ArrowLeft', 400);
            expect((await player(page)).support).toEqual({ type: 'elevator', id: 0 });
        });

        test('walking has no effect on a car the spy is not standing on', async ({ page }) => {
            await start(page);
            await parkCars(page, 0);
            await place(page, 2, 300);
            await holdFor(page, 'ArrowDown', 60);
            expect(await page.evaluate(() => elevators[0].y)).toBe(await page.evaluate(() => floorY(0)));
        });
    });

    // -----------------------------------------------------------------------
    // Ducking
    // -----------------------------------------------------------------------
    test.describe('ducking', () => {
        test('Down on a floor ducks and shrinks the spy', async ({ page }) => {
            await start(page);
            await place(page, 2, 300);
            await hold(page, 'ArrowDown');
            await step(page, 2);
            expect((await player(page)).ducking).toBe(true);
            expect(await page.evaluate(() => playerHeight())).toBe(await page.evaluate(() => DUCK_H));
        });

        test('releasing Down stands the spy back up', async ({ page }) => {
            await start(page);
            await place(page, 2, 300);
            await holdFor(page, 'ArrowDown', 4);
            await step(page, 2);
            expect((await player(page)).ducking).toBe(false);
            expect(await page.evaluate(() => playerHeight())).toBe(await page.evaluate(() => PLAYER_H));
        });

        test('a ducking spy cannot walk', async ({ page }) => {
            await start(page);
            await place(page, 2, 300);
            await hold(page, 'ArrowDown');
            await hold(page, 'ArrowRight');
            await step(page, 60);
            await hold(page, 'ArrowDown', false);
            await hold(page, 'ArrowRight', false);
            expect((await player(page)).x).toBe(300);
        });

        test('a spy on a car drives it instead of ducking', async ({ page }) => {
            await start(page);
            await page.evaluate(() => { boardElevator(0, floorY(1)); });
            await hold(page, 'ArrowDown');
            await step(page, 30);
            expect((await player(page)).ducking).toBe(false);
            expect(await page.evaluate(() => elevators[0].y))
                .toBeGreaterThan(await page.evaluate(() => floorY(1)));
        });
    });

    // -----------------------------------------------------------------------
    // Shooting
    // -----------------------------------------------------------------------
    test.describe('shooting', () => {
        test('Space fires a bullet in the facing direction', async ({ page }) => {
            await start(page);
            await place(page, 2, 300);
            await page.evaluate(() => { player.facing = 1; shoot(); });
            const b = await page.evaluate(() => bullets[0]);
            expect(b.from).toBe('player');
            expect(b.vx).toBeGreaterThan(0);
            expect(b.y).toBe(await page.evaluate(() => floorY(2) - BULLET_Y_OFF));
        });

        test('facing left fires left', async ({ page }) => {
            await start(page);
            await place(page, 2, 300);
            await page.evaluate(() => { player.facing = -1; shoot(); });
            expect(await page.evaluate(() => bullets[0].vx)).toBeLessThan(0);
        });

        test('the keyboard fires too', async ({ page }) => {
            await start(page);
            await place(page, 2, 300);
            await page.keyboard.press('Space');
            expect(await page.evaluate(() => bullets.length)).toBe(1);
        });

        test('at most three player bullets are alive at once', async ({ page }) => {
            await start(page);
            await place(page, 2, 300);
            await page.evaluate(() => { for (let i = 0; i < 8; i++) shoot(); });
            expect(await page.evaluate(() => bullets.length))
                .toBe(await page.evaluate(() => MAX_PLAYER_BULLETS));
        });

        test('a bullet travels and then leaves the building', async ({ page }) => {
            await start(page);
            await place(page, 2, 300);
            await page.evaluate(() => { player.facing = 1; shoot(); });
            const x0 = await page.evaluate(() => bullets[0].x);
            await step(page, 20);
            expect(await page.evaluate(() => bullets[0].x)).toBeGreaterThan(x0);
            await step(page, 400);
            expect(await page.evaluate(() => bullets.length)).toBe(0);
        });

        test('a ducking spy cannot shoot', async ({ page }) => {
            await start(page);
            await place(page, 2, 300);
            await hold(page, 'ArrowDown');
            await step(page, 2);
            await page.evaluate(() => shoot());
            expect(await page.evaluate(() => bullets.length)).toBe(0);
        });

        test('shooting does nothing while the game is not running', async ({ page }) => {
            await page.evaluate(() => shoot());
            expect(await page.evaluate(() => bullets.length)).toBe(0);
        });
    });

    // -----------------------------------------------------------------------
    // Agents
    // -----------------------------------------------------------------------
    test.describe('agents', () => {
        test('an agent spawns on its floor standing on the surface', async ({ page }) => {
            await start(page);
            await page.evaluate(() => spawnEnemyAt(3, 300));
            const e = await page.evaluate(() => enemies[0]);
            expect(e.floor).toBe(3);
            expect(e.y).toBe(await page.evaluate(() => floorY(3)));
            expect(e.alive).toBe(true);
        });

        test('an agent patrols and turns at a shaft edge', async ({ page }) => {
            await start(page);
            await place(page, 0, 596);
            await page.evaluate(() => { enemies.length = 0; spawnEnemyAt(3, 300); enemies[0].dir = 1; });
            await step(page, 300);
            const e = await page.evaluate(() => enemies[0]);
            expect(e.x).toBeLessThanOrEqual(await page.evaluate(() => SHAFTS[1] - ENEMY_W / 2) + 0.01);
            expect(e.dir).toBe(-1);
        });

        test('an agent turns at the outer wall', async ({ page }) => {
            await start(page);
            await place(page, 0, 596);
            await page.evaluate(() => { enemies.length = 0; spawnEnemyAt(3, 560); enemies[0].dir = 1; });
            await step(page, 150);
            const e = await page.evaluate(() => enemies[0]);
            expect(e.x).toBeLessThanOrEqual(await page.evaluate(() => W - MARGIN - ENEMY_W / 2) + 0.01);
            expect(e.dir).toBe(-1);
        });

        test('an agent turns to face the spy sharing its floor', async ({ page }) => {
            await start(page);
            await place(page, 3, 380);
            await page.evaluate(() => { enemies.length = 0; spawnEnemyAt(3, 300); enemies[0].dir = -1; });
            await step(page, 4);
            expect(await page.evaluate(() => enemies[0].dir)).toBe(1);
        });

        test('an agent shoots along the floor it shares with the spy', async ({ page }) => {
            await start(page);
            await place(page, 3, 380);
            const shot = await page.evaluate(() => {
                enemies.length = 0;
                spawnEnemyAt(3, 290);
                let seen = false;
                for (let i = 0; i < 240; i++) {
                    physicsStep(1 / 120);
                    if (bullets.some((b) => b.from === 'enemy')) seen = true;
                }
                return seen;
            });
            expect(shot).toBe(true);
        });

        test('an agent does not shoot at a spy on another floor', async ({ page }) => {
            await start(page);
            await place(page, 5, 380);
            await page.evaluate(() => { enemies.length = 0; spawnEnemyAt(3, 290); });
            await step(page, 600);
            expect(await page.evaluate(() => bullets.length)).toBe(0);
        });

        test('a player bullet kills an agent and scores', async ({ page }) => {
            await start(page);
            await place(page, 3, 300);
            await page.evaluate(() => {
                enemies.length = 0;
                spawnEnemyAt(3, 380);
                player.facing = 1;
                shoot();
            });
            await step(page, 60);
            expect(await page.evaluate(() => enemies.length)).toBe(0);
            expect(await page.evaluate(() => score)).toBe(await page.evaluate(() => ENEMY_POINTS));
            expect(await page.evaluate(() => bullets.length)).toBe(0);
        });

        test('a player bullet passes a different floor harmlessly', async ({ page }) => {
            await start(page);
            await place(page, 3, 300);
            await page.evaluate(() => {
                enemies.length = 0;
                spawnEnemyAt(5, 380);
                player.facing = 1;
                shoot();
            });
            await step(page, 60);
            expect(await page.evaluate(() => enemies.length)).toBe(1);
            expect(await page.evaluate(() => score)).toBe(0);
        });

        test('agents spawn over time while the game runs', async ({ page }) => {
            await start(page, { enemies: true });
            const seen = await page.evaluate(() => {
                let most = 0;
                for (let i = 0; i < 1200; i++) {
                    physicsStep(1 / 120);
                    most = Math.max(most, enemies.length);
                }
                return most;
            });
            expect(seen).toBeGreaterThan(0);
        });

        test('the number of live agents is capped', async ({ page }) => {
            await start(page, { enemies: true });
            const most = await page.evaluate(() => {
                lives = 9999; // keep the level running so spawning never pauses
                let n = 0;
                for (let i = 0; i < 6000; i++) {
                    physicsStep(1 / 120);
                    n = Math.max(n, enemies.length);
                }
                return n;
            });
            const cap = await page.evaluate(() => maxEnemies());
            expect(cap).toBe(4);
            expect(most).toBeGreaterThan(0);
            expect(most).toBeLessThanOrEqual(cap);
        });

        test('agents only ever appear at grey doors', async ({ page }) => {
            await start(page, { enemies: true });
            const bad = await page.evaluate(() => {
                lives = 9999;
                let wrong = 0;
                for (let i = 0; i < 4000; i++) {
                    physicsStep(1 / 120);
                    wrong += enemies.filter((e) => doors.some((d) =>
                        d.red && d.floor === e.floor && Math.abs(d.x - e.spawnX) < 1)).length;
                }
                return wrong;
            });
            expect(bad).toBe(0);
        });
    });

    // -----------------------------------------------------------------------
    // Getting shot
    // -----------------------------------------------------------------------
    test.describe('getting shot', () => {
        test('an agent bullet costs a life', async ({ page }) => {
            await start(page);
            await place(page, 3, 380);
            await page.evaluate(() => { enemies.length = 0; spawnEnemyAt(3, 290); });
            await step(page, 180);
            expect(await page.evaluate(() => lives)).toBe(2);
            expect(await page.evaluate(() => state)).toBe('dying');
        });

        test('a ducking spy is missed', async ({ page }) => {
            await start(page);
            await place(page, 3, 380);
            await hold(page, 'ArrowDown');
            await page.evaluate(() => { enemies.length = 0; spawnEnemyAt(3, 290); });
            await step(page, 600);
            await hold(page, 'ArrowDown', false);
            expect(await page.evaluate(() => lives)).toBe(3);
            expect(await page.evaluate(() => state)).toBe('running');
        });

        test('the spy respawns on the roof after a pause', async ({ page }) => {
            await start(page);
            await place(page, 4, 300);
            await page.evaluate(() => killPlayer());
            expect(await page.evaluate(() => state)).toBe('dying');
            await step(page, 150);
            expect(await page.evaluate(() => state)).toBe('running');
            const p = await player(page);
            expect(p.support).toEqual({ type: 'floor', index: 0 });
            expect(p.alive).toBe(true);
        });

        test('a death clears the agents and bullets in play', async ({ page }) => {
            await start(page);
            await place(page, 4, 300);
            await page.evaluate(() => { spawnEnemyAt(4, 350); shoot(); killPlayer(); });
            await step(page, 150);
            expect(await page.evaluate(() => enemies.length)).toBe(0);
            expect(await page.evaluate(() => bullets.length)).toBe(0);
        });

        test('collected documents survive a death', async ({ page }) => {
            await start(page);
            await page.evaluate(() => { doors.find((d) => d.red).taken = true; });
            const before = await page.evaluate(() => docsLeft());
            await page.evaluate(() => killPlayer());
            await step(page, 150);
            expect(await page.evaluate(() => docsLeft())).toBe(before);
        });

        test('the third death ends the game', async ({ page }) => {
            await start(page);
            for (let i = 0; i < 3; i++) {
                await page.evaluate(() => killPlayer());
                await step(page, 150);
            }
            expect(await page.evaluate(() => lives)).toBe(0);
            expect(await page.evaluate(() => state)).toBe('gameover');
            await expect(page.locator('#overlay')).toHaveClass(/visible/);
            await expect(page.locator('#overlay-title')).toContainText(/over/i);
        });

        test('nothing moves once the game is over', async ({ page }) => {
            await start(page);
            await page.evaluate(() => { lives = 1; killPlayer(); });
            await place(page, 2, 300);
            await holdFor(page, 'ArrowRight', 60);
            expect((await player(page)).x).toBe(300);
        });
    });

    // -----------------------------------------------------------------------
    // Documents
    // -----------------------------------------------------------------------
    test.describe('documents', () => {
        test('walking into a red door takes its document', async ({ page }) => {
            await start(page);
            const door = await page.evaluate(() => {
                const d = doors.find((x) => x.red);
                placePlayerOnFloor(d.floor, d.x);
                return { floor: d.floor, x: d.x };
            });
            await step(page, 2);
            expect(await page.evaluate(() => docsLeft())).toBe(3);
            expect(await page.evaluate(() => score)).toBe(await page.evaluate(() => DOC_POINTS));
            const open = await page.evaluate(([f, x]) =>
                doors.find((d) => d.floor === f && d.x === x).open, [door.floor, door.x]);
            expect(open).toBe(true);
        });

        test('a red door only pays out once', async ({ page }) => {
            await start(page);
            await page.evaluate(() => {
                const d = doors.find((x) => x.red);
                placePlayerOnFloor(d.floor, d.x);
            });
            await step(page, 120);
            expect(await page.evaluate(() => score)).toBe(await page.evaluate(() => DOC_POINTS));
            expect(await page.evaluate(() => docsLeft())).toBe(3);
        });

        test('a grey door gives nothing', async ({ page }) => {
            await start(page);
            await page.evaluate(() => {
                const d = doors.find((x) => !x.red);
                placePlayerOnFloor(d.floor, d.x);
            });
            await step(page, 60);
            expect(await page.evaluate(() => score)).toBe(0);
            expect(await page.evaluate(() => docsLeft())).toBe(4);
        });

        test('a door on another floor is not collected', async ({ page }) => {
            await start(page);
            await page.evaluate(() => {
                const d = doors.find((x) => x.red);
                placePlayerOnFloor(d.floor === 5 ? 0 : d.floor + 1, d.x);
            });
            await step(page, 60);
            expect(await page.evaluate(() => docsLeft())).toBe(4);
        });

        test('the HUD counts the documents down', async ({ page }) => {
            await start(page);
            await expect(page.locator('#docs')).toHaveText('4');
            await page.evaluate(() => {
                const d = doors.find((x) => x.red);
                placePlayerOnFloor(d.floor, d.x);
            });
            await step(page, 2);
            await expect(page.locator('#docs')).toHaveText('3');
        });
    });

    // -----------------------------------------------------------------------
    // Escaping
    // -----------------------------------------------------------------------
    test.describe('escaping', () => {
        test('the getaway car is dark until every document is in hand', async ({ page }) => {
            await start(page);
            expect(await page.evaluate(() => exitReady())).toBe(false);
            await place(page, 6, 100);
            await step(page, 60);
            expect(await page.evaluate(() => state)).toBe('running');
        });

        test('reaching the car with every document clears the level', async ({ page }) => {
            await start(page);
            await page.evaluate(() => { doors.forEach((d) => { if (d.red) d.taken = true; }); });
            expect(await page.evaluate(() => exitReady())).toBe(true);
            await place(page, 6, 100);
            await step(page, 2);
            expect(await page.evaluate(() => state)).toBe('levelclear');
        });

        test('the escape pays a bonus', async ({ page }) => {
            await start(page);
            await page.evaluate(() => {
                score = 0;
                doors.forEach((d) => { if (d.red) d.taken = true; });
                placePlayerOnFloor(6, 100);
            });
            await step(page, 2);
            expect(await page.evaluate(() => score))
                .toBe(await page.evaluate(() => ESCAPE_BONUS + 100 * 1));
        });

        test('standing anywhere else on the garage floor does not escape', async ({ page }) => {
            await start(page);
            await page.evaluate(() => {
                doors.forEach((d) => { if (d.red) d.taken = true; });
                placePlayerOnFloor(6, 560);
            });
            await step(page, 60);
            expect(await page.evaluate(() => state)).toBe('running');
        });

        test('Space after a level clear starts the next level', async ({ page }) => {
            await start(page);
            await page.evaluate(() => {
                doors.forEach((d) => { if (d.red) d.taken = true; });
                placePlayerOnFloor(6, 100);
            });
            await step(page, 2);
            await page.keyboard.press('Space');
            expect(await page.evaluate(() => level)).toBe(2);
            expect(await page.evaluate(() => state)).toBe('running');
            expect(await page.evaluate(() => docsLeft())).toBe(5);
            expect((await player(page)).support).toEqual({ type: 'floor', index: 0 });
        });

        test('a new level keeps the score and the lives', async ({ page }) => {
            await start(page);
            await page.evaluate(() => {
                lives = 2;
                doors.forEach((d) => { if (d.red) d.taken = true; });
                placePlayerOnFloor(6, 100);
            });
            await step(page, 2);
            const banked = await page.evaluate(() => score);
            await page.keyboard.press('Space');
            expect(await page.evaluate(() => score)).toBe(banked);
            expect(await page.evaluate(() => lives)).toBe(2);
        });
    });

    // -----------------------------------------------------------------------
    // Pausing and the HUD
    // -----------------------------------------------------------------------
    test.describe('pause and HUD', () => {
        test('P pauses and resumes', async ({ page }) => {
            await start(page);
            await page.keyboard.press('KeyP');
            expect(await page.evaluate(() => state)).toBe('paused');
            await expect(page.locator('#overlay')).toHaveClass(/visible/);
            await page.keyboard.press('KeyP');
            expect(await page.evaluate(() => state)).toBe('running');
        });

        test('a paused game does not move', async ({ page }) => {
            await start(page);
            await place(page, 2, 300);
            await page.evaluate(() => togglePause());
            await holdFor(page, 'ArrowRight', 120);
            expect((await player(page)).x).toBe(300);
        });

        test('pausing does nothing before the game starts', async ({ page }) => {
            await page.keyboard.press('KeyP');
            expect(await page.evaluate(() => state)).toBe('idle');
        });

        test('the HUD tracks score, level and lives', async ({ page }) => {
            await start(page);
            await page.evaluate(() => { score = 1234; lives = 2; level = 3; updateHud(); });
            await expect(page.locator('#score')).toHaveText('1234');
            await expect(page.locator('#lives')).toHaveText('2');
            await expect(page.locator('#level')).toHaveText('3');
        });

        test('the best score is remembered across a reload', async ({ page }) => {
            await start(page);
            await page.evaluate(() => { score = 4200; lives = 1; killPlayer(); });
            expect(await page.evaluate(() => state)).toBe('gameover');
            await page.reload();
            await expect(page.locator('#best')).toHaveText('4200');
        });
    });

    // -----------------------------------------------------------------------
    // Playing for real
    // -----------------------------------------------------------------------
    test.describe('playing for real', () => {
        test('a scripted descent rides a car to the garage and reaches the exit', async ({ page }) => {
            await start(page);
            const result = await page.evaluate(() => {
                const press = (code, on) => { keys[code] = on; };
                const run = (n) => { for (let i = 0; i < n; i++) physicsStep(1 / 120); };

                // Walk left along the roof until standing on the left-hand car.
                press('ArrowLeft', true);
                let guard = 0;
                while (!(player.support.type === 'elevator' && player.support.id === 0) && guard++ < 4000) run(1);
                press('ArrowLeft', false);
                const boarded = player.support.type === 'elevator';

                // Ride it all the way down to the garage.
                press('ArrowDown', true);
                guard = 0;
                while (elevators[0].y < floorY(FLOOR_COUNT - 1) && guard++ < 4000) run(1);
                press('ArrowDown', false);
                run(2);
                const atGarage = Math.abs(elevators[0].y - floorY(FLOOR_COUNT - 1)) < 0.01;

                // Step off and walk to the getaway car.
                press('ArrowLeft', true);
                guard = 0;
                while (player.x > EXIT.x + EXIT.w / 2 && guard++ < 4000) run(1);
                press('ArrowLeft', false);

                return {
                    boarded,
                    atGarage,
                    floor: player.support.type === 'floor' ? player.support.index : -1,
                    x: player.x,
                    docs: docsLeft(),
                    state,
                };
            });
            expect(result.boarded).toBe(true);
            expect(result.atGarage).toBe(true);
            expect(result.floor).toBe(6);
            expect(result.x).toBeLessThan(160);
            expect(result.docs).toBe(4); // no red door stands on that route

            expect(result.state).toBe('running');
        });

        test('collecting every document and driving off clears the level', async ({ page }) => {
            await start(page);
            const result = await page.evaluate(() => {
                const run = (n) => { for (let i = 0; i < n; i++) physicsStep(1 / 120); };
                doors.filter((d) => d.red).forEach((d) => {
                    placePlayerOnFloor(d.floor, d.x);
                    run(2);
                });
                placePlayerOnFloor(6, EXIT.x + EXIT.w / 2);
                run(2);
                return { state, score, docs: docsLeft() };
            });
            expect(result.docs).toBe(0);
            expect(result.state).toBe('levelclear');
            expect(result.score).toBe(4 * 500 + 1000 + 100);
        });

        test('a long unattended run never breaks the invariants', async ({ page }) => {
            await start(page, { enemies: true });
            const bad = await page.evaluate(() => {
                lives = 9999; // the point is the invariants, not the life count
                for (let i = 0; i < 12000; i++) {
                    physicsStep(1 / 120);
                    if (state !== 'running' && state !== 'dying') return `state ${state}`;
                    if (player.x < MARGIN - 1 || player.x > W - MARGIN + 1) return `x ${player.x}`;
                    if (player.y < floorY(0) - 1 || player.y > floorY(FLOOR_COUNT - 1) + 1) return `y ${player.y}`;
                    for (const e of elevators) {
                        if (e.y < floorY(0) - 0.01 || e.y > floorY(FLOOR_COUNT - 1) + 0.01) return `car ${e.y}`;
                    }
                    for (const e of enemies) {
                        if (e.x < MARGIN - 1 || e.x > W - MARGIN + 1) return `enemy ${e.x}`;
                    }
                    if (bullets.length > 40) return `bullets ${bullets.length}`;
                }
                return null;
            });
            expect(bad).toBeNull();
        });

        test('a scripted firefight kills agents without crashing', async ({ page }) => {
            await start(page);
            const result = await page.evaluate(() => {
                const run = (n) => { for (let i = 0; i < n; i++) physicsStep(1 / 120); };
                placePlayerOnFloor(3, 270);
                let killed = 0;
                for (let round = 0; round < 4; round++) {
                    enemies.length = 0;
                    spawnEnemyAt(3, 390);
                    player.facing = 1;
                    shoot();
                    run(90);
                    if (enemies.length === 0) killed++;
                }
                return { killed, score, lives };
            });
            expect(result.killed).toBe(4);
            expect(result.score).toBe(800);
            expect(result.lives).toBe(3);
        });
    });

    // -----------------------------------------------------------------------
    // Game browser integration
    // -----------------------------------------------------------------------
    test.describe('game browser integration', () => {
        test('games.json lists Elevator Action', () => {
            const games = JSON.parse(
                fs.readFileSync(path.join(REPO_ROOT, 'game-browser/src/assets/games.json'), 'utf8')
            );
            const entry = games.find((g) => g.id === 'elevator-action');
            expect(entry).toBeTruthy();
            expect(entry.name).toBe('Elevator Action');
            expect(entry.dir).toBe('ElevatorAction');
            expect(entry.path).toBe('games/ElevatorAction/index.html');
            expect(entry.thumbnail).toBe('games/ElevatorAction/screenshot.png');
            expect(entry.description.length).toBeGreaterThan(10);
        });

        test('the games.json entry stays alphabetically sorted by name', () => {
            const games = JSON.parse(
                fs.readFileSync(path.join(REPO_ROOT, 'game-browser/src/assets/games.json'), 'utf8')
            );
            const i = games.findIndex((g) => g.id === 'elevator-action');
            expect(i).toBeGreaterThan(0);
            expect(games[i - 1].name.localeCompare(games[i].name)).toBeLessThanOrEqual(0);
            if (i + 1 < games.length) {
                expect(games[i].name.localeCompare(games[i + 1].name)).toBeLessThanOrEqual(0);
            }
        });

        test('the thumbnail the browser points at exists', () => {
            expect(fs.existsSync(path.join(REPO_ROOT, 'ElevatorAction/screenshot.png'))).toBe(true);
        });

        test('the root README lists the game', () => {
            const readme = fs.readFileSync(path.join(REPO_ROOT, 'README.md'), 'utf8');
            expect(readme).toMatch(
                /\|\s*Elevator Action\s*\|\s*\[ElevatorAction\/\]\(ElevatorAction\/\)\s*\|\s*(Complete|In Progress)\s*\|/);
        });

        test('the game ships its own README and DESIGN docs', () => {
            expect(fs.existsSync(path.join(REPO_ROOT, 'ElevatorAction/README.md'))).toBe(true);
            expect(fs.existsSync(path.join(REPO_ROOT, 'ElevatorAction/DESIGN.md'))).toBe(true);
        });
    });
});
