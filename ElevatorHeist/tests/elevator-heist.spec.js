const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');

const GAME_URL = pathToFileURL(path.resolve(__dirname, '../index.html')).href;
const REPO_ROOT = path.resolve(__dirname, '../..');

// Start a run and freeze the animation loop so each test can place the world in
// a known state and advance the simulation one fixed timestep at a time.
async function startFrozen(page) {
    await page.evaluate(() => {
        startGame();
        autoRun = false;
        agents.length = 0;
        bullets.length = 0;
    });
}

// Advance the frozen simulation by `steps` fixed 1/60s timesteps.
async function step(page, steps = 1) {
    await page.evaluate((n) => {
        for (let i = 0; i < n; i++) physicsStep(1 / 60);
    }, steps);
}

// Put the player on a floor at a known position, out of any shaft.
async function placePlayer(page, floor, x, facing = 1) {
    await page.evaluate((p) => {
        player.inShaft = null;
        player.floor = p.floor;
        player.y = floorY(p.floor);
        player.x = p.x;
        player.facing = p.facing;
        player.invuln = 0;
    }, { floor, x, facing });
}

// Replace the agent list with exactly the agents a test cares about.
async function setAgents(page, list) {
    await page.evaluate((items) => {
        agents.length = 0;
        items.forEach((a) => agents.push(makeAgent(a.floor, a.x, a.dir)));
    }, list);
}

async function read(page, expr) {
    return page.evaluate(expr);
}

test.describe('Elevator Heist', () => {
    test.beforeEach(async ({ page }) => {
        await page.goto(GAME_URL);
    });

    // -----------------------------------------------------------------------
    // Initial / idle state
    // -----------------------------------------------------------------------
    test.describe('initial state', () => {
        test('page title is Elevator Heist', async ({ page }) => {
            await expect(page).toHaveTitle('Elevator Heist');
        });

        test('canvas is 720x640', async ({ page }) => {
            const canvas = page.locator('#canvas');
            await expect(canvas).toHaveAttribute('width', '720');
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
            await expect(page.locator('#lives')).toHaveText('3');
            await expect(page.locator('#docs')).toHaveText('0/3');
            await expect(page.locator('#best')).toHaveText('0');
        });

        test('state is idle before starting', async ({ page }) => {
            expect(await read(page, () => state)).toBe('idle');
        });

        test('no agents, bullets or doors before starting', async ({ page }) => {
            expect(await read(page, () => agents.length)).toBe(0);
            expect(await read(page, () => bullets.length)).toBe(0);
            expect(await read(page, () => doors.length)).toBe(0);
        });

        test('the help text explains the controls', async ({ page }) => {
            const help = page.locator('.help');
            await expect(help).toContainText(/elevator|car/i);
            await expect(help).toContainText(/fire|shoot/i);
        });
    });

    // -----------------------------------------------------------------------
    // Level layout
    // -----------------------------------------------------------------------
    test.describe('level layout', () => {
        test('starting a run puts the game in the running state', async ({ page }) => {
            await page.evaluate(() => startGame());
            expect(await read(page, () => state)).toBe('running');
            await expect(page.locator('#overlay')).not.toHaveClass(/visible/);
        });

        test('the player starts on the roof, outside a shaft', async ({ page }) => {
            await page.evaluate(() => startGame());
            expect(await read(page, () => player.floor)).toBe(0);
            expect(await read(page, () => player.y === floorY(0))).toBe(true);
            expect(await read(page, () => player.inShaft)).toBeNull();
        });

        test('six doors are laid out, none of them on the ground floor', async ({ page }) => {
            await page.evaluate(() => startGame());
            expect(await read(page, () => doors.length)).toBe(6);
            expect(await read(page, () => doors.every((d) => d.floor >= 0 && d.floor < FLOORS - 1))).toBe(true);
        });

        test('exactly three doors hide a document and none start opened', async ({ page }) => {
            await page.evaluate(() => startGame());
            expect(await read(page, () => doors.filter((d) => d.hasDoc).length)).toBe(3);
            expect(await read(page, () => doors.some((d) => d.opened))).toBe(false);
            expect(await read(page, () => docsRequired)).toBe(3);
            expect(await read(page, () => docsCollected)).toBe(0);
        });

        test('no two doors share a spot and none block a shaft', async ({ page }) => {
            await page.evaluate(() => startGame());
            const clearsShafts = await read(page, () =>
                doors.every((d) => SHAFTS.every((sx) => Math.abs(d.x - sx) >= 50))
            );
            expect(clearsShafts).toBe(true);
            const unique = await read(page, () => new Set(doors.map((d) => `${d.floor}:${d.x}`)).size);
            expect(unique).toBe(6);
        });

        test('two elevator cars exist, parked at the roof and the ground floor', async ({ page }) => {
            await page.evaluate(() => startGame());
            expect(await read(page, () => elevators.length)).toBe(2);
            expect(await read(page, () => elevators[0].y === floorY(0))).toBe(true);
            expect(await read(page, () => elevators[1].y === floorY(FLOORS - 1))).toBe(true);
            expect(await read(page, () => elevators.map((e) => e.x))).toEqual([180, 420]);
        });

        test('agents spawn below the roof so the run cannot open with a hit', async ({ page }) => {
            await page.evaluate(() => startGame());
            expect(await read(page, () => agents.length)).toBeGreaterThan(0);
            expect(await read(page, () => agents.every((a) => a.floor >= 1))).toBe(true);
        });

        test('the same level always generates the same layout', async ({ page }) => {
            const snapshot = () => page.evaluate(() => {
                startGame();
                return JSON.stringify(doors);
            });
            expect(await snapshot()).toBe(await snapshot());
        });
    });

    // -----------------------------------------------------------------------
    // Walking
    // -----------------------------------------------------------------------
    test.describe('walking', () => {
        test('holding right walks right and faces right', async ({ page }) => {
            await startFrozen(page);
            await placePlayer(page, 0, 300, -1);
            await page.evaluate(() => { keys.right = true; });
            await step(page, 6);
            expect(await read(page, () => player.x)).toBeGreaterThan(310);
            expect(await read(page, () => player.facing)).toBe(1);
        });

        test('holding left walks left and faces left', async ({ page }) => {
            await startFrozen(page);
            await placePlayer(page, 0, 300, 1);
            await page.evaluate(() => { keys.left = true; });
            await step(page, 6);
            expect(await read(page, () => player.x)).toBeLessThan(290);
            expect(await read(page, () => player.facing)).toBe(-1);
        });

        test('the player cannot walk through the left wall', async ({ page }) => {
            await startFrozen(page);
            await placePlayer(page, 0, 300);
            await page.evaluate(() => { keys.left = true; });
            await step(page, 300);
            expect(await read(page, () => player.x)).toBeCloseTo(await read(page, () => WALL_L + PLAYER_W / 2), 3);
        });

        test('the player cannot walk through the right wall', async ({ page }) => {
            await startFrozen(page);
            await placePlayer(page, 0, 300);
            await page.evaluate(() => { keys.right = true; });
            await step(page, 300);
            expect(await read(page, () => player.x)).toBeCloseTo(await read(page, () => WALL_R - PLAYER_W / 2), 3);
        });

        test('holding both directions stands still', async ({ page }) => {
            await startFrozen(page);
            await placePlayer(page, 0, 300);
            await page.evaluate(() => { keys.left = true; keys.right = true; });
            await step(page, 30);
            expect(await read(page, () => player.x)).toBe(300);
        });

        test('the player cannot walk sideways while inside a car', async ({ page }) => {
            await startFrozen(page);
            await placePlayer(page, 0, 180);
            await page.evaluate(() => { pressVertical(1); keys.right = true; });
            await step(page, 30);
            expect(await read(page, () => player.inShaft)).toBe(0);
            expect(await read(page, () => player.x)).toBe(180);
        });
    });

    // -----------------------------------------------------------------------
    // Elevators
    // -----------------------------------------------------------------------
    test.describe('elevators', () => {
        test('pressing up boards a car that is level with the player', async ({ page }) => {
            await startFrozen(page);
            await placePlayer(page, 0, 180);
            await page.evaluate(() => pressVertical(-1));
            expect(await read(page, () => player.inShaft)).toBe(0);
            expect(await read(page, () => player.x)).toBe(180);
        });

        test('a car that is not level with the player cannot be boarded', async ({ page }) => {
            await startFrozen(page);
            await placePlayer(page, 0, 180);
            await page.evaluate(() => { elevators[0].y = floorY(0) + 40; });
            await page.evaluate(() => pressVertical(1));
            expect(await read(page, () => player.inShaft)).toBeNull();
        });

        test('a car out of reach cannot be boarded', async ({ page }) => {
            await startFrozen(page);
            await placePlayer(page, 0, 300);
            await page.evaluate(() => pressVertical(1));
            expect(await read(page, () => player.inShaft)).toBeNull();
        });

        test('holding down drives the car down and carries the player', async ({ page }) => {
            await startFrozen(page);
            await placePlayer(page, 0, 180);
            await page.evaluate(() => { pressVertical(1); keys.down = true; });
            await step(page, 60);
            expect(await read(page, () => elevators[0].y)).toBeCloseTo(await read(page, () => floorY(0) + ELEV_SPEED), 3);
            expect(await read(page, () => player.y === elevators[0].y)).toBe(true);
        });

        test('holding up drives the car back up', async ({ page }) => {
            await startFrozen(page);
            await placePlayer(page, 2, 180);
            await page.evaluate(() => { elevators[0].y = floorY(2); pressVertical(-1); keys.up = true; });
            await step(page, 30);
            expect(await read(page, () => elevators[0].y)).toBeCloseTo(await read(page, () => floorY(2) - ELEV_SPEED / 2), 3);
        });

        test('a car stops at the top of its shaft', async ({ page }) => {
            await startFrozen(page);
            await placePlayer(page, 0, 180);
            await page.evaluate(() => { pressVertical(-1); keys.up = true; });
            await step(page, 120);
            expect(await read(page, () => elevators[0].y)).toBe(await read(page, () => floorY(0)));
        });

        test('a car stops at the bottom of its shaft', async ({ page }) => {
            await startFrozen(page);
            await placePlayer(page, 0, 180);
            await page.evaluate(() => { pressVertical(1); keys.down = true; });
            await step(page, 600);
            expect(await read(page, () => elevators[0].y)).toBe(await read(page, () => floorY(FLOORS - 1)));
            expect(await read(page, () => player.floor)).toBe(5);
        });

        test('a player between floors has no floor, which is what keeps them safe', async ({ page }) => {
            await startFrozen(page);
            await placePlayer(page, 0, 180);
            await page.evaluate(() => { pressVertical(1); keys.down = true; });
            await step(page, 30);
            expect(await read(page, () => player.floor)).toBe(-1);
        });

        test('stepping out sideways at a floor leaves the shaft', async ({ page }) => {
            await startFrozen(page);
            await placePlayer(page, 0, 180);
            await page.evaluate(() => { pressVertical(1); elevators[0].y = floorY(2); });
            await step(page, 1);
            await page.evaluate(() => pressHorizontal(1));
            expect(await read(page, () => player.inShaft)).toBeNull();
            expect(await read(page, () => player.floor)).toBe(2);
            expect(await read(page, () => player.x)).toBeGreaterThan(180);
            expect(await read(page, () => player.y === floorY(2))).toBe(true);
            expect(await read(page, () => player.facing)).toBe(1);
        });

        test('the player cannot step out between floors', async ({ page }) => {
            await startFrozen(page);
            await placePlayer(page, 0, 180);
            await page.evaluate(() => { pressVertical(1); elevators[0].y = floorY(2) + 30; });
            await step(page, 1);
            await page.evaluate(() => pressHorizontal(-1));
            expect(await read(page, () => player.inShaft)).toBe(0);
        });

        test('pressing up at a shaft with no car summons the nearest one', async ({ page }) => {
            await startFrozen(page);
            await placePlayer(page, 3, 180);
            await page.evaluate(() => pressVertical(-1));
            expect(await read(page, () => player.inShaft)).toBeNull();
            expect(await read(page, () => elevators[0].call)).toBe(3);
        });

        test('a summoned car travels to the calling floor and stops there', async ({ page }) => {
            await startFrozen(page);
            await placePlayer(page, 3, 180);
            await page.evaluate(() => pressVertical(-1));
            await step(page, 300);
            expect(await read(page, () => elevators[0].y)).toBe(await read(page, () => floorY(3)));
            expect(await read(page, () => elevators[0].call)).toBeNull();
        });

        test('a summoned car can then be boarded, so nobody is ever stranded', async ({ page }) => {
            await startFrozen(page);
            await placePlayer(page, 3, 180);
            await page.evaluate(() => pressVertical(-1));
            await step(page, 300);
            await page.evaluate(() => pressVertical(-1));
            expect(await read(page, () => player.inShaft)).toBe(0);
            expect(await read(page, () => elevators[0].call)).toBeNull();
        });

        test('a car being ridden ignores a call', async ({ page }) => {
            await startFrozen(page);
            await placePlayer(page, 0, 180);
            await page.evaluate(() => { pressVertical(-1); elevators[0].call = 0; keys.down = true; });
            await step(page, 60);
            expect(await read(page, () => elevators[0].y)).toBeGreaterThan(await read(page, () => floorY(0)));
        });

        test('an idle car with no call stays where it is', async ({ page }) => {
            await startFrozen(page);
            await placePlayer(page, 0, 60);
            const before = await read(page, () => elevators[1].y);
            await step(page, 120);
            expect(await read(page, () => elevators[1].y)).toBe(before);
        });

        test('the second car can be boarded from the ground floor', async ({ page }) => {
            await startFrozen(page);
            await placePlayer(page, 5, 420);
            await page.evaluate(() => pressVertical(-1));
            expect(await read(page, () => player.inShaft)).toBe(1);
        });
    });

    // -----------------------------------------------------------------------
    // Doors and documents
    // -----------------------------------------------------------------------
    test.describe('doors', () => {
        async function atDoor(page, wantDoc) {
            return page.evaluate((want) => {
                const door = doors.find((d) => d.hasDoc === want && !d.opened);
                player.inShaft = null;
                player.floor = door.floor;
                player.y = floorY(door.floor);
                player.x = door.x;
                player.invuln = 0;
                return doors.indexOf(door);
            }, wantDoc);
        }

        test('opening a document door collects it and scores', async ({ page }) => {
            await startFrozen(page);
            const i = await atDoor(page, true);
            await page.evaluate(() => pressVertical(-1));
            expect(await read(page, () => docsCollected)).toBe(1);
            expect(await read(page, () => score)).toBeGreaterThanOrEqual(200);
            expect(await page.evaluate((n) => doors[n].opened, i)).toBe(true);
            await expect(page.locator('#docs')).toHaveText('1/3');
        });

        test('the same door cannot be looted twice', async ({ page }) => {
            await startFrozen(page);
            await atDoor(page, true);
            await page.evaluate(() => { pressVertical(-1); pressVertical(-1); pressVertical(-1); });
            expect(await read(page, () => docsCollected)).toBe(1);
        });

        test('an empty door lets a security agent out', async ({ page }) => {
            await startFrozen(page);
            await atDoor(page, false);
            await page.evaluate(() => pressVertical(-1));
            expect(await read(page, () => docsCollected)).toBe(0);
            expect(await read(page, () => agents.length)).toBe(1);
            expect(await read(page, () => agents[0].floor)).toBe(await read(page, () => player.floor));
        });

        test('pressing up away from any door does nothing', async ({ page }) => {
            await startFrozen(page);
            await page.evaluate(() => {
                const door = doors[0];
                player.inShaft = null;
                player.floor = door.floor;
                player.y = floorY(door.floor);
                player.x = door.x + 90;
            });
            await page.evaluate(() => pressVertical(-1));
            expect(await read(page, () => doors.some((d) => d.opened))).toBe(false);
            expect(await read(page, () => agents.length)).toBe(0);
        });

        test('doors on other floors are out of reach', async ({ page }) => {
            await startFrozen(page);
            await page.evaluate(() => {
                const door = doors[0];
                player.inShaft = null;
                player.floor = (door.floor + 1) % (FLOORS - 1);
                player.y = floorY(player.floor);
                player.x = door.x;
            });
            await page.evaluate(() => pressVertical(-1));
            expect(await read(page, () => doors[0].opened)).toBe(false);
        });

        test('collecting all three documents unlocks the exit', async ({ page }) => {
            await startFrozen(page);
            await page.evaluate(() => {
                doors.filter((d) => d.hasDoc).forEach((door) => {
                    player.inShaft = null;
                    player.floor = door.floor;
                    player.y = floorY(door.floor);
                    player.x = door.x;
                    pressVertical(-1);
                });
            });
            expect(await read(page, () => docsCollected)).toBe(3);
            expect(await read(page, () => exitOpen())).toBe(true);
            await expect(page.locator('#docs')).toHaveText('3/3');
        });
    });

    // -----------------------------------------------------------------------
    // Shooting
    // -----------------------------------------------------------------------
    test.describe('shooting', () => {
        test('firing creates a bullet travelling the way the player faces', async ({ page }) => {
            await startFrozen(page);
            await placePlayer(page, 0, 300, 1);
            await page.evaluate(() => firePlayerBullet());
            expect(await read(page, () => bullets.length)).toBe(1);
            expect(await read(page, () => bullets[0].vx)).toBeGreaterThan(0);
            expect(await read(page, () => bullets[0].from)).toBe('player');
        });

        test('facing left fires left', async ({ page }) => {
            await startFrozen(page);
            await placePlayer(page, 0, 300, -1);
            await page.evaluate(() => firePlayerBullet());
            expect(await read(page, () => bullets[0].vx)).toBeLessThan(0);
        });

        test('the player cannot shoot from inside a car', async ({ page }) => {
            await startFrozen(page);
            await placePlayer(page, 0, 180, 1);
            await page.evaluate(() => { pressVertical(-1); player.shootCd = 0; firePlayerBullet(); });
            expect(await read(page, () => player.inShaft)).toBe(0);
            expect(await read(page, () => bullets.length)).toBe(0);
        });

        test('stepping out of a car restores the ability to shoot', async ({ page }) => {
            await startFrozen(page);
            await placePlayer(page, 0, 180, 1);
            await page.evaluate(() => { pressVertical(-1); pressHorizontal(1); player.shootCd = 0; firePlayerBullet(); });
            expect(await read(page, () => bullets.length)).toBe(1);
        });

        test('a cooldown stops the player machine-gunning', async ({ page }) => {
            await startFrozen(page);
            await placePlayer(page, 0, 300, 1);
            await page.evaluate(() => { firePlayerBullet(); firePlayerBullet(); firePlayerBullet(); });
            expect(await read(page, () => bullets.length)).toBe(1);
            await step(page, 20);
            await page.evaluate(() => firePlayerBullet());
            expect(await read(page, () => bullets.filter((b) => b.from === 'player').length)).toBe(2);
        });

        test('at most three player bullets are in the air', async ({ page }) => {
            await startFrozen(page);
            await placePlayer(page, 0, 300, 1);
            await page.evaluate(() => {
                for (let i = 0; i < 6; i++) { player.shootCd = 0; firePlayerBullet(); }
            });
            expect(await read(page, () => bullets.filter((b) => b.from === 'player').length)).toBe(3);
        });

        test('a bullet that reaches the wall disappears', async ({ page }) => {
            await startFrozen(page);
            await placePlayer(page, 0, 300, 1);
            await page.evaluate(() => firePlayerBullet());
            await step(page, 120);
            expect(await read(page, () => bullets.length)).toBe(0);
        });

        test('a player bullet drops an agent on the same floor and scores', async ({ page }) => {
            await startFrozen(page);
            await placePlayer(page, 0, 200, 1);
            await setAgents(page, [{ floor: 0, x: 320, dir: -1 }]);
            await page.evaluate(() => { score = 0; firePlayerBullet(); });
            await step(page, 30);
            expect(await read(page, () => agents.length)).toBe(0);
            expect(await read(page, () => score)).toBe(150);
        });

        test('a player bullet ignores agents on other floors', async ({ page }) => {
            await startFrozen(page);
            await placePlayer(page, 0, 200, 1);
            await setAgents(page, [{ floor: 2, x: 320, dir: -1 }]);
            await page.evaluate(() => firePlayerBullet());
            await step(page, 60);
            expect(await read(page, () => agents.length)).toBe(1);
        });

        test('a player bullet behind the player misses', async ({ page }) => {
            await startFrozen(page);
            await placePlayer(page, 0, 200, 1);
            await setAgents(page, [{ floor: 0, x: 80, dir: 1 }]);
            await page.evaluate(() => { agents[0].shootCd = 99; firePlayerBullet(); });
            await step(page, 30);
            expect(await read(page, () => agents.length)).toBe(1);
        });
    });

    // -----------------------------------------------------------------------
    // Security agents
    // -----------------------------------------------------------------------
    test.describe('security agents', () => {
        test('an agent patrols in its facing direction', async ({ page }) => {
            await startFrozen(page);
            await placePlayer(page, 0, 300);
            await setAgents(page, [{ floor: 3, x: 300, dir: 1 }]);
            await step(page, 60);
            expect(await read(page, () => agents[0].x)).toBeGreaterThan(330);
        });

        test('an agent turns round at a wall', async ({ page }) => {
            await startFrozen(page);
            await placePlayer(page, 0, 300);
            await setAgents(page, [{ floor: 3, x: 670, dir: 1 }]);
            await step(page, 60);
            expect(await read(page, () => agents[0].dir)).toBe(-1);
            expect(await read(page, () => agents[0].x)).toBeLessThanOrEqual(await read(page, () => WALL_R));
        });

        test('an agent turns to face a player who shares its floor', async ({ page }) => {
            await startFrozen(page);
            await placePlayer(page, 2, 100);
            await setAgents(page, [{ floor: 2, x: 400, dir: 1 }]);
            await step(page, 1);
            expect(await read(page, () => agents[0].dir)).toBe(-1);
        });

        test('an agent takes a moment to aim before it fires', async ({ page }) => {
            await startFrozen(page);
            await placePlayer(page, 2, 100);
            await setAgents(page, [{ floor: 2, x: 400, dir: -1 }]);
            await page.evaluate(() => { agents[0].shootCd = 0; });
            await step(page, 1);
            expect(await read(page, () => bullets.length)).toBe(0);
            expect(await read(page, () => agents[0].shootCd)).toBeGreaterThan(0);
        });

        test('an agent facing the player on their floor opens fire', async ({ page }) => {
            await startFrozen(page);
            await placePlayer(page, 2, 100);
            await setAgents(page, [{ floor: 2, x: 400, dir: -1 }]);
            await page.evaluate(() => { agents[0].shootCd = 0; });
            await step(page, 40);
            const shots = await read(page, () => bullets.filter((b) => b.from === 'agent'));
            expect(shots.length).toBe(1);
            expect(shots[0].vx).toBeLessThan(0);
        });

        test('an agent reloads between shots', async ({ page }) => {
            await startFrozen(page);
            await placePlayer(page, 2, 100);
            await setAgents(page, [{ floor: 2, x: 400, dir: -1 }]);
            await page.evaluate(() => { agents[0].shootCd = 0; });
            await step(page, 40);
            await page.evaluate(() => { bullets.length = 0; });
            await step(page, 60);
            expect(await read(page, () => bullets.filter((b) => b.from === 'agent').length)).toBe(0);
        });

        test('breaking line of sight makes an agent aim again', async ({ page }) => {
            await startFrozen(page);
            await placePlayer(page, 2, 100);
            await setAgents(page, [{ floor: 2, x: 400, dir: -1 }]);
            await page.evaluate(() => { agents[0].shootCd = 0; });
            await step(page, 40);
            await page.evaluate(() => { bullets.length = 0; player.floor = 4; player.y = floorY(4); });
            await step(page, 120);
            await page.evaluate(() => { player.floor = 2; player.y = floorY(2); player.x = 100; });
            await step(page, 1);
            expect(await read(page, () => bullets.length)).toBe(0);
            expect(await read(page, () => agents[0].shootCd)).toBeGreaterThan(0);
        });

        test('agents cannot shoot a player riding between floors', async ({ page }) => {
            await startFrozen(page);
            await placePlayer(page, 0, 180);
            await setAgents(page, [{ floor: 0, x: 400, dir: -1 }]);
            await page.evaluate(() => {
                agents[0].shootCd = 0;
                pressVertical(1);
                keys.down = true;
            });
            await step(page, 30);
            expect(await read(page, () => player.floor)).toBe(-1);
            expect(await read(page, () => bullets.filter((b) => b.from === 'agent').length)).toBe(0);
        });

        test('an agent bullet costs a life and sends the player back to the roof', async ({ page }) => {
            await startFrozen(page);
            await placePlayer(page, 2, 300);
            await page.evaluate(() => {
                bullets.push({ x: player.x - 8, y: floorY(2) - 18, vx: 300, from: 'agent' });
            });
            await step(page, 3);
            expect(await read(page, () => lives)).toBe(2);
            expect(await read(page, () => player.floor)).toBe(0);
            expect(await read(page, () => player.inShaft)).toBeNull();
            expect(await read(page, () => bullets.length)).toBe(0);
            await expect(page.locator('#lives')).toHaveText('2');
        });

        test('walking into an agent costs a life', async ({ page }) => {
            await startFrozen(page);
            await placePlayer(page, 2, 300);
            await setAgents(page, [{ floor: 2, x: 302, dir: -1 }]);
            await step(page, 2);
            expect(await read(page, () => lives)).toBe(2);
        });

        test('the player is briefly invulnerable after being hit', async ({ page }) => {
            await startFrozen(page);
            await placePlayer(page, 2, 300);
            await setAgents(page, [{ floor: 2, x: 302, dir: -1 }]);
            await step(page, 2);
            expect(await read(page, () => player.invuln)).toBeGreaterThan(0);
            await page.evaluate(() => {
                player.floor = 2;
                player.y = floorY(2);
                player.x = 302;
            });
            await step(page, 2);
            expect(await read(page, () => lives)).toBe(2);
        });

        test('invulnerability wears off', async ({ page }) => {
            await startFrozen(page);
            await placePlayer(page, 2, 300);
            await page.evaluate(() => { player.invuln = 0.1; });
            await step(page, 12);
            expect(await read(page, () => player.invuln)).toBe(0);
        });
    });

    // -----------------------------------------------------------------------
    // Lives and game over
    // -----------------------------------------------------------------------
    test.describe('losing', () => {
        test('losing the last life ends the run', async ({ page }) => {
            await startFrozen(page);
            await placePlayer(page, 2, 300);
            await page.evaluate(() => { lives = 1; });
            await setAgents(page, [{ floor: 2, x: 302, dir: -1 }]);
            await step(page, 2);
            expect(await read(page, () => lives)).toBe(0);
            expect(await read(page, () => state)).toBe('gameover');
            await expect(page.locator('#overlay')).toHaveClass(/visible/);
            await expect(page.locator('#overlay-title')).toContainText(/over/i);
        });

        test('the game over overlay reports the score', async ({ page }) => {
            await startFrozen(page);
            await placePlayer(page, 2, 300);
            await page.evaluate(() => { lives = 1; score = 1234; });
            await setAgents(page, [{ floor: 2, x: 302, dir: -1 }]);
            await step(page, 2);
            await expect(page.locator('#overlay-score')).toContainText('1234');
        });

        test('the best score is remembered', async ({ page }) => {
            await startFrozen(page);
            await placePlayer(page, 2, 300);
            await page.evaluate(() => { lives = 1; score = 4321; });
            await setAgents(page, [{ floor: 2, x: 302, dir: -1 }]);
            await step(page, 2);
            await expect(page.locator('#best')).toHaveText('4321');
            await page.reload();
            await expect(page.locator('#best')).toHaveText('4321');
        });

        test('restarting resets the run', async ({ page }) => {
            await startFrozen(page);
            await page.evaluate(() => { lives = 1; score = 500; level = 3; });
            await placePlayer(page, 2, 300);
            await setAgents(page, [{ floor: 2, x: 302, dir: -1 }]);
            await step(page, 2);
            await page.evaluate(() => startGame());
            expect(await read(page, () => state)).toBe('running');
            expect(await read(page, () => lives)).toBe(3);
            expect(await read(page, () => score)).toBe(0);
            expect(await read(page, () => level)).toBe(1);
            expect(await read(page, () => docsCollected)).toBe(0);
        });
    });

    // -----------------------------------------------------------------------
    // Escaping and levels
    // -----------------------------------------------------------------------
    test.describe('escaping', () => {
        test('the exit is shut until every document is found', async ({ page }) => {
            await startFrozen(page);
            await placePlayer(page, 5, 660);
            await step(page, 2);
            expect(await read(page, () => level)).toBe(1);
            expect(await read(page, () => exitOpen())).toBe(false);
        });

        test('reaching the exit with the documents promotes the player', async ({ page }) => {
            await startFrozen(page);
            await page.evaluate(() => { docsCollected = docsRequired; score = 0; });
            await placePlayer(page, 5, 660);
            await step(page, 2);
            expect(await read(page, () => level)).toBe(2);
            expect(await read(page, () => docsCollected)).toBe(0);
            expect(await read(page, () => score)).toBeGreaterThanOrEqual(500);
            await expect(page.locator('#level')).toHaveText('2');
        });

        test('a new level rebuilds the building and the player is back on the roof', async ({ page }) => {
            await startFrozen(page);
            const before = await read(page, () => JSON.stringify(doors));
            await page.evaluate(() => { docsCollected = docsRequired; });
            await placePlayer(page, 5, 660);
            await step(page, 2);
            expect(await read(page, () => JSON.stringify(doors))).not.toBe(before);
            expect(await read(page, () => player.floor)).toBe(0);
            expect(await read(page, () => doors.filter((d) => d.hasDoc).length)).toBe(3);
        });

        test('later levels field more agents', async ({ page }) => {
            const count = (lvl) => page.evaluate((l) => {
                startGame();
                level = l;
                buildLevel();
                return agents.length;
            }, lvl);
            expect(await count(4)).toBeGreaterThan(await count(1));
        });

        test('the exit stays reachable on the ground floor only', async ({ page }) => {
            await startFrozen(page);
            await page.evaluate(() => { docsCollected = docsRequired; });
            await placePlayer(page, 3, 660);
            await step(page, 2);
            expect(await read(page, () => level)).toBe(1);
        });
    });

    // -----------------------------------------------------------------------
    // Pausing
    // -----------------------------------------------------------------------
    test.describe('pausing', () => {
        test('pause freezes the simulation and the overlay explains', async ({ page }) => {
            await startFrozen(page);
            await placePlayer(page, 0, 300);
            await page.evaluate(() => { keys.right = true; togglePause(); });
            expect(await read(page, () => state)).toBe('paused');
            await page.evaluate(() => { for (let i = 0; i < 30; i++) tick(1 / 60); });
            expect(await read(page, () => player.x)).toBe(300);
            await expect(page.locator('#overlay-title')).toContainText(/pause/i);
        });

        test('unpausing resumes the simulation', async ({ page }) => {
            await startFrozen(page);
            await placePlayer(page, 0, 300);
            await page.evaluate(() => { keys.right = true; togglePause(); togglePause(); });
            expect(await read(page, () => state)).toBe('running');
            await page.evaluate(() => { for (let i = 0; i < 30; i++) tick(1 / 60); });
            expect(await read(page, () => player.x)).toBeGreaterThan(300);
        });

        test('pause does nothing before the game starts', async ({ page }) => {
            await page.evaluate(() => togglePause());
            expect(await read(page, () => state)).toBe('idle');
        });
    });

    // -----------------------------------------------------------------------
    // Keyboard and mouse wiring
    // -----------------------------------------------------------------------
    test.describe('input wiring', () => {
        test('space starts a run from the title screen', async ({ page }) => {
            await page.keyboard.press('Space');
            expect(await read(page, () => state)).toBe('running');
        });

        test('the start button starts a run', async ({ page }) => {
            await page.locator('#btn-start').click();
            expect(await read(page, () => state)).toBe('running');
        });

        test('arrow keys set and clear the held state', async ({ page }) => {
            await page.keyboard.press('Space');
            await page.evaluate(() => { autoRun = false; });
            await page.keyboard.down('ArrowRight');
            expect(await read(page, () => keys.right)).toBe(true);
            await page.keyboard.up('ArrowRight');
            expect(await read(page, () => keys.right)).toBe(false);
        });

        test('WASD works as well as the arrows', async ({ page }) => {
            await page.keyboard.press('Space');
            await page.evaluate(() => { autoRun = false; });
            await page.keyboard.down('KeyA');
            expect(await read(page, () => keys.left)).toBe(true);
            await page.keyboard.up('KeyA');
            await page.keyboard.down('KeyS');
            expect(await read(page, () => keys.down)).toBe(true);
            await page.keyboard.up('KeyS');
        });

        test('P pauses from the keyboard', async ({ page }) => {
            await page.keyboard.press('Space');
            await page.evaluate(() => { autoRun = false; });
            await page.keyboard.press('KeyP');
            expect(await read(page, () => state)).toBe('paused');
        });

        test('space fires once the run is under way', async ({ page }) => {
            await page.keyboard.press('Space');
            await page.evaluate(() => { autoRun = false; bullets.length = 0; player.shootCd = 0; });
            await page.keyboard.press('Space');
            expect(await read(page, () => bullets.filter((b) => b.from === 'player').length)).toBe(1);
        });
    });

    // -----------------------------------------------------------------------
    // Rendering
    // -----------------------------------------------------------------------
    test.describe('rendering', () => {
        test('the canvas is painted once a run starts', async ({ page }) => {
            await page.evaluate(() => { startGame(); autoRun = false; render(); });
            const distinct = await page.evaluate(() => {
                const data = canvas.getContext('2d').getImageData(0, 0, 720, 640).data;
                const seen = new Set();
                for (let i = 0; i < data.length; i += 4 * 97) {
                    seen.add(`${data[i]},${data[i + 1]},${data[i + 2]}`);
                }
                return seen.size;
            });
            expect(distinct).toBeGreaterThan(3);
        });

        test('rendering survives every game state', async ({ page }) => {
            const errors = [];
            page.on('pageerror', (e) => errors.push(e.message));
            await page.evaluate(() => {
                render();
                startGame();
                autoRun = false;
                render();
                togglePause();
                render();
                togglePause();
                player.invuln = 1;
                bullets.push({ x: 100, y: 100, vx: 10, from: 'agent' });
                pressVertical(-1);
                render();
                gameOver();
                render();
            });
            expect(errors).toEqual([]);
        });

        test('the animation loop runs on its own until stopped', async ({ page }) => {
            await page.evaluate(() => { startGame(); keys.right = true; });
            const first = await read(page, () => player.x);
            await page.waitForTimeout(250);
            const second = await read(page, () => player.x);
            expect(second).toBeGreaterThan(first);
        });
    });

    // -----------------------------------------------------------------------
    // Repo integration
    // -----------------------------------------------------------------------
    test.describe('repo integration', () => {
        test('the game browser catalogue lists the game', () => {
            const games = JSON.parse(
                fs.readFileSync(path.join(REPO_ROOT, 'game-browser/src/assets/games.json'), 'utf8')
            );
            const entry = games.find((g) => g.id === 'elevator-heist');
            expect(entry).toBeTruthy();
            expect(entry.name).toBe('Elevator Heist');
            expect(entry.dir).toBe('ElevatorHeist');
            expect(entry.path).toBe('games/ElevatorHeist/index.html');
            expect(entry.thumbnail).toBe('games/ElevatorHeist/screenshot.png');
            expect(entry.category).toBe('Action');
            expect(entry.description.length).toBeGreaterThan(10);
        });

        test('the catalogue entry stays alphabetically sorted by name', () => {
            const games = JSON.parse(
                fs.readFileSync(path.join(REPO_ROOT, 'game-browser/src/assets/games.json'), 'utf8')
            );
            const i = games.findIndex((g) => g.id === 'elevator-heist');
            expect(i).toBeGreaterThan(0);
            expect(games[i - 1].name.localeCompare(games[i].name)).toBeLessThanOrEqual(0);
            if (i + 1 < games.length) {
                expect(games[i].name.localeCompare(games[i + 1].name)).toBeLessThanOrEqual(0);
            }
        });

        test('the thumbnail the browser points at exists', () => {
            expect(fs.existsSync(path.join(REPO_ROOT, 'ElevatorHeist/screenshot.png'))).toBe(true);
        });

        test('the root README lists the game', () => {
            const readme = fs.readFileSync(path.join(REPO_ROOT, 'README.md'), 'utf8');
            expect(readme).toMatch(
                /\|\s*Elevator Heist\s*\|\s*\[ElevatorHeist\/\]\(ElevatorHeist\/\)\s*\|\s*(Complete|In Progress)\s*\|/
            );
        });

        test('the game ships its own README and DESIGN docs', () => {
            expect(fs.existsSync(path.join(REPO_ROOT, 'ElevatorHeist/README.md'))).toBe(true);
            expect(fs.existsSync(path.join(REPO_ROOT, 'ElevatorHeist/DESIGN.md'))).toBe(true);
        });

        test('the DESIGN doc records the assumptions that were made', () => {
            const design = fs.readFileSync(path.join(REPO_ROOT, 'ElevatorHeist/DESIGN.md'), 'utf8');
            expect(design).toMatch(/##\s*Assumptions/);
        });
    });
});
