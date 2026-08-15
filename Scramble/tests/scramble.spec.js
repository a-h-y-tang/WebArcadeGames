const { test, expect } = require('@playwright/test');
const path = require('path');
const { pathToFileURL } = require('url');

const GAME_URL = pathToFileURL(path.resolve(__dirname, '../index.html')).href;

// Fly forward for `n` frames while holding the ship in the middle of the cave,
// so terrain never ends the run for tests that only care about progress.
const flySafely = (n) => `(() => {
    for (let i = 0; i < ${n}; i++) {
        const t = terrainAt(ship.x + SHIP_W / 2);
        ship.y = (t.ceilingY + t.groundY) / 2 - SHIP_H / 2;
        step(0.016);
    }
})()`;

test.describe('Scramble', () => {
    test.beforeEach(async ({ page }) => {
        await page.goto(GAME_URL);
    });

    // -----------------------------------------------------------------------
    // Initial / idle state
    // -----------------------------------------------------------------------
    test.describe('initial state', () => {
        test('page title is Scramble', async ({ page }) => {
            await expect(page).toHaveTitle('Scramble');
        });

        test('start overlay is visible', async ({ page }) => {
            await expect(page.locator('#overlay')).toHaveClass(/visible/);
        });

        test('overlay prompts the player to start', async ({ page }) => {
            await expect(page.locator('#overlay-sub')).toContainText(/space|start/i);
        });

        test('canvas is 640x400', async ({ page }) => {
            const canvas = page.locator('#canvas');
            await expect(canvas).toHaveAttribute('width', '640');
            await expect(canvas).toHaveAttribute('height', '400');
        });

        test('score starts at 0 and lives at 3', async ({ page }) => {
            await expect(page.locator('#score')).toHaveText('0');
            await expect(page.locator('#lives')).toHaveText('3');
        });

        test('fuel gauge starts full', async ({ page }) => {
            await expect(page.locator('#fuel')).toHaveText('100');
            await expect(page.locator('#fuel-bar')).toHaveAttribute('style', /width:\s*100%/);
        });

        test('state is idle before starting', async ({ page }) => {
            expect(await page.evaluate(() => state)).toBe('idle');
        });

        test('stepping while idle does not scroll the world', async ({ page }) => {
            const moved = await page.evaluate(() => {
                const before = camX;
                for (let i = 0; i < 30; i++) step(0.016);
                return camX !== before;
            });
            expect(moved).toBe(false);
        });

        test('high score loads from localStorage', async ({ page }) => {
            await page.evaluate(() => window.localStorage.setItem('scramble-best', '4200'));
            await page.reload();
            await expect(page.locator('#best')).toHaveText('4200');
        });
    });

    // -----------------------------------------------------------------------
    // Level generation
    // -----------------------------------------------------------------------
    test.describe('level generation', () => {
        test('terrain spans the whole level', async ({ page }) => {
            const lens = await page.evaluate(() => ({
                ceiling: terrain.ceiling.length,
                ground: terrain.ground.length,
                cols: LEVEL_COLS,
            }));
            expect(lens.ceiling).toBe(lens.cols);
            expect(lens.ground).toBe(lens.cols);
        });

        test('generation is deterministic for a given seed', async ({ page }) => {
            const same = await page.evaluate(() => {
                const a = generateTerrain(4321);
                const b = generateTerrain(4321);
                return JSON.stringify(a) === JSON.stringify(b);
            });
            expect(same).toBe(true);
        });

        test('different seeds produce different caves', async ({ page }) => {
            const same = await page.evaluate(() => {
                const a = generateTerrain(1);
                const b = generateTerrain(2);
                return JSON.stringify(a) === JSON.stringify(b);
            });
            expect(same).toBe(false);
        });

        test('every column leaves a flyable gap', async ({ page }) => {
            const narrowest = await page.evaluate(() => {
                let min = Infinity;
                for (let i = 0; i < LEVEL_COLS; i++) {
                    min = Math.min(min, CANVAS_H - terrain.ceiling[i] - terrain.ground[i]);
                }
                return { min, required: MIN_GAP };
            });
            expect(narrowest.min).toBeGreaterThanOrEqual(narrowest.required);
        });

        test('the launch area is open sky', async ({ page }) => {
            const opening = await page.evaluate(() =>
                terrain.ceiling.slice(0, 6).every((c) => c === 0));
            expect(opening).toBe(true);
        });

        test('terrainAt maps world x to the column under it', async ({ page }) => {
            const probe = await page.evaluate(() => {
                const t = terrainAt(COL_W * 12 + 5);
                return {
                    ceilingY: t.ceilingY,
                    groundY: t.groundY,
                    expectedCeiling: terrain.ceiling[12],
                    expectedGround: CANVAS_H - terrain.ground[12],
                };
            });
            expect(probe.ceilingY).toBe(probe.expectedCeiling);
            expect(probe.groundY).toBe(probe.expectedGround);
        });

        test('the level is split into named zones', async ({ page }) => {
            const zones = await page.evaluate(() => ({
                names: ZONES,
                cols: ZONE_COLS,
                total: LEVEL_COLS,
            }));
            expect(zones.names.length).toBeGreaterThan(1);
            expect(zones.cols * zones.names.length).toBe(zones.total);
        });

        test('the cave is populated with fuel tanks and rockets', async ({ page }) => {
            const counts = await page.evaluate(() => {
                const c = { tank: 0, rocket: 0, ufo: 0 };
                entities.forEach((e) => { c[e.type]++; });
                return c;
            });
            expect(counts.tank).toBeGreaterThan(5);
            expect(counts.rocket).toBeGreaterThan(5);
            expect(counts.ufo).toBeGreaterThan(0);
        });

        test('ground enemies rest on the ground', async ({ page }) => {
            const grounded = await page.evaluate(() => entities
                .filter((e) => e.type !== 'ufo')
                .every((e) => Math.abs(e.y + e.h - terrainAt(e.x + e.w / 2).groundY) < 1.5));
            expect(grounded).toBe(true);
        });

        test('no enemy is buried inside the ceiling', async ({ page }) => {
            const clear = await page.evaluate(() =>
                entities.every((e) => e.y >= terrainAt(e.x + e.w / 2).ceilingY));
            expect(clear).toBe(true);
        });
    });

    // -----------------------------------------------------------------------
    // Starting a run
    // -----------------------------------------------------------------------
    test.describe('starting', () => {
        test('Space starts the game', async ({ page }) => {
            await page.keyboard.press('Space');
            expect(await page.evaluate(() => state)).toBe('running');
            await expect(page.locator('#overlay')).not.toHaveClass(/visible/);
        });

        test('the start button starts the game', async ({ page }) => {
            await page.click('#btn-start');
            expect(await page.evaluate(() => state)).toBe('running');
        });

        test('the ship starts alive in open air', async ({ page }) => {
            await page.click('#btn-start');
            const ok = await page.evaluate(() => {
                const t = terrainAt(ship.x + SHIP_W / 2);
                return ship.alive && ship.y > t.ceilingY && ship.y + SHIP_H < t.groundY;
            });
            expect(ok).toBe(true);
        });

        test('restarting resets score, lives and fuel', async ({ page }) => {
            await page.click('#btn-start');
            const fresh = await page.evaluate(() => {
                score = 500;
                lives = 1;
                fuel = 10;
                startGame();
                return { score, lives, fuel };
            });
            expect(fresh).toEqual({ score: 0, lives: 3, fuel: 100 });
        });
    });

    // -----------------------------------------------------------------------
    // Flying
    // -----------------------------------------------------------------------
    test.describe('flying', () => {
        test.beforeEach(async ({ page }) => {
            await page.click('#btn-start');
        });

        test('the world scrolls forward on its own', async ({ page }) => {
            const delta = await page.evaluate((body) => {
                const before = camX;
                eval(body);
                return camX - before;
            }, flySafely(60));
            expect(delta).toBeGreaterThan(0);
        });

        test('the ship drifts forward with the scroll', async ({ page }) => {
            const delta = await page.evaluate((body) => {
                const before = ship.x;
                eval(body);
                return ship.x - before;
            }, flySafely(60));
            expect(delta).toBeGreaterThan(0);
        });

        test('ArrowUp climbs and ArrowDown dives', async ({ page }) => {
            await page.keyboard.down('ArrowUp');
            const up = await page.evaluate(() => {
                const before = ship.y;
                for (let i = 0; i < 10; i++) step(0.016);
                return ship.y - before;
            });
            await page.keyboard.up('ArrowUp');
            expect(up).toBeLessThan(0);

            await page.keyboard.down('ArrowDown');
            const down = await page.evaluate(() => {
                const before = ship.y;
                for (let i = 0; i < 10; i++) step(0.016);
                return ship.y - before;
            });
            await page.keyboard.up('ArrowDown');
            expect(down).toBeGreaterThan(0);
        });

        test('ArrowRight outruns the scroll and ArrowLeft falls back', async ({ page }) => {
            const drift = await page.evaluate((body) => {
                const before = ship.x - camX;
                eval(body);
                return ship.x - camX - before;
            }, flySafely(20));

            await page.keyboard.down('ArrowRight');
            const fast = await page.evaluate((body) => {
                const before = ship.x - camX;
                eval(body);
                return ship.x - camX - before;
            }, flySafely(20));
            await page.keyboard.up('ArrowRight');
            expect(fast).toBeGreaterThan(drift);

            await page.keyboard.down('ArrowLeft');
            const slow = await page.evaluate((body) => {
                const before = ship.x - camX;
                eval(body);
                return ship.x - camX - before;
            }, flySafely(20));
            await page.keyboard.up('ArrowLeft');
            expect(slow).toBeLessThan(0);
        });

        test('the ship cannot be flown off the back of the screen', async ({ page }) => {
            await page.keyboard.down('ArrowLeft');
            const screenX = await page.evaluate((body) => {
                eval(body);
                return ship.x - camX;
            }, flySafely(300));
            await page.keyboard.up('ArrowLeft');
            expect(screenX).toBeGreaterThan(await page.evaluate(() => SHIP_MIN_SCREEN) - 0.01);
        });

        test('the ship cannot be flown past the front of the screen', async ({ page }) => {
            await page.keyboard.down('ArrowRight');
            const screenX = await page.evaluate((body) => {
                eval(body);
                return ship.x - camX;
            }, flySafely(300));
            await page.keyboard.up('ArrowRight');
            expect(screenX).toBeLessThan(await page.evaluate(() => SHIP_MAX_SCREEN) + 0.01);
        });

        test('WASD works as an alternative to the arrow keys', async ({ page }) => {
            await page.keyboard.down('w');
            const up = await page.evaluate(() => {
                const before = ship.y;
                for (let i = 0; i < 10; i++) step(0.016);
                return ship.y - before;
            });
            await page.keyboard.up('w');
            expect(up).toBeLessThan(0);
        });
    });

    // -----------------------------------------------------------------------
    // Fuel
    // -----------------------------------------------------------------------
    test.describe('fuel', () => {
        test.beforeEach(async ({ page }) => {
            await page.click('#btn-start');
        });

        test('fuel burns while flying', async ({ page }) => {
            const burned = await page.evaluate((body) => {
                const before = fuel;
                eval(body);
                return before - fuel;
            }, flySafely(60));
            expect(burned).toBeGreaterThan(0);
        });

        test('the fuel gauge tracks the tank', async ({ page }) => {
            await page.evaluate(() => { state = 'paused'; fuel = 40; updateHud(); });
            await expect(page.locator('#fuel')).toHaveText('40');
            await expect(page.locator('#fuel-bar')).toHaveAttribute('style', /width:\s*40%/);
        });

        test('running dry costs a life', async ({ page }) => {
            const after = await page.evaluate(() => {
                fuel = 0.01;
                step(0.05);
                return { state, lives, fuel };
            });
            expect(after.fuel).toBe(0);
            expect(after.state).toBe('dead');
            expect(after.lives).toBe(2);
        });

        test('bombing a fuel tank refuels the ship', async ({ page }) => {
            const result = await page.evaluate(() => {
                const tank = entities.find((e) => e.type === 'tank');
                fuel = 50;
                bombs.push({ x: tank.x + tank.w / 2, y: tank.y + tank.h / 2, vx: 0, vy: 0 });
                step(0.016);
                return { fuel, alive: tank.alive, score };
            });
            expect(result.alive).toBe(false);
            expect(result.fuel).toBeGreaterThan(50);
            expect(result.score).toBeGreaterThan(0);
        });

        test('refuelling never overfills the tank', async ({ page }) => {
            const fuelLeft = await page.evaluate(() => {
                const tank = entities.find((e) => e.type === 'tank');
                fuel = 95;
                bombs.push({ x: tank.x + tank.w / 2, y: tank.y + tank.h / 2, vx: 0, vy: 0 });
                step(0.016);
                return fuel;
            });
            expect(fuelLeft).toBeLessThanOrEqual(100);
        });

        test('shooting a tank scores but does not refuel', async ({ page }) => {
            const result = await page.evaluate(() => {
                const tank = entities.find((e) => e.type === 'tank');
                fuel = 50;
                bullets.push({ x: tank.x + tank.w / 2, y: tank.y + tank.h / 2, vx: 0 });
                step(0.016);
                return { fuel, alive: tank.alive, score };
            });
            expect(result.alive).toBe(false);
            expect(result.score).toBeGreaterThan(0);
            expect(result.fuel).toBeLessThanOrEqual(50);
        });
    });

    // -----------------------------------------------------------------------
    // Weapons
    // -----------------------------------------------------------------------
    test.describe('weapons', () => {
        test.beforeEach(async ({ page }) => {
            await page.click('#btn-start');
        });

        test('Space fires the laser', async ({ page }) => {
            await page.keyboard.press('Space');
            expect(await page.evaluate(() => bullets.length)).toBe(1);
        });

        test('lasers travel forward and leave the screen', async ({ page }) => {
            const flight = await page.evaluate(() => {
                fireLaser();
                const startX = bullets[0].x;
                step(0.1);
                const moved = bullets.length ? bullets[0].x - startX : Infinity;
                for (let i = 0; i < 200; i++) step(0.016);
                return { moved, left: bullets.length };
            });
            expect(flight.moved).toBeGreaterThan(0);
            expect(flight.left).toBe(0);
        });

        test('only a few lasers can be in the air at once', async ({ page }) => {
            const count = await page.evaluate(() => {
                for (let i = 0; i < 20; i++) { fireLaser(); laserCooldown = 0; }
                return bullets.length;
            });
            expect(count).toBeLessThanOrEqual(await page.evaluate(() => LASER_MAX));
        });

        test('the laser has a cooldown between shots', async ({ page }) => {
            const count = await page.evaluate(() => {
                fireLaser();
                fireLaser();
                return bullets.length;
            });
            expect(count).toBe(1);
        });

        test('B drops a bomb', async ({ page }) => {
            await page.keyboard.press('b');
            expect(await page.evaluate(() => bombs.length)).toBe(1);
        });

        test('bombs arc forward and downward', async ({ page }) => {
            const arc = await page.evaluate(() => {
                dropBomb();
                const b = bombs[0];
                const start = { x: b.x, y: b.y, vy: b.vy };
                for (let i = 0; i < 12; i++) step(0.016);
                return { dx: b.x - start.x, dy: b.y - start.y, faster: b.vy > start.vy };
            });
            expect(arc.dx).toBeGreaterThan(0);
            expect(arc.dy).toBeGreaterThan(0);
            expect(arc.faster).toBe(true);
        });

        test('bombs burst when they reach the ground', async ({ page }) => {
            const left = await page.evaluate(() => {
                dropBomb();
                for (let i = 0; i < 240; i++) step(0.016);
                return bombs.length;
            });
            expect(left).toBe(0);
        });

        test('lasers are stopped by the cave wall', async ({ page }) => {
            const left = await page.evaluate(() => {
                bullets.push({ x: ship.x + 60, y: CANVAS_H - 1, vx: LASER_SPEED });
                step(0.016);
                return bullets.length;
            });
            expect(left).toBe(0);
        });

        test('weapons are inert while the game is not running', async ({ page }) => {
            const fired = await page.evaluate(() => {
                state = 'paused';
                fireLaser();
                dropBomb();
                return bullets.length + bombs.length;
            });
            expect(fired).toBe(0);
        });
    });

    // -----------------------------------------------------------------------
    // Enemies
    // -----------------------------------------------------------------------
    test.describe('enemies', () => {
        test.beforeEach(async ({ page }) => {
            await page.click('#btn-start');
        });

        test('rockets stay grounded until the ship gets close', async ({ page }) => {
            const launched = await page.evaluate(() => {
                const r = entities.find((e) => e.type === 'rocket');
                placeShipAt(r.x - ROCKET_TRIGGER - 300);
                step(0.016);
                return r.launched;
            });
            expect(launched).toBe(false);
        });

        test('rockets launch when the ship approaches', async ({ page }) => {
            const rocket = await page.evaluate(() => {
                const r = entities.find((e) => e.type === 'rocket');
                placeShipAt(r.x - ROCKET_TRIGGER + 20);
                const y0 = r.y;
                for (let i = 0; i < 20; i++) step(0.016);
                return { launched: r.launched, climbed: y0 - r.y };
            });
            expect(rocket.launched).toBe(true);
            expect(rocket.climbed).toBeGreaterThan(0);
        });

        test('a rocket that hits the ship destroys it', async ({ page }) => {
            const after = await page.evaluate(() => {
                const r = entities.find((e) => e.type === 'rocket');
                placeShipAt(r.x);
                r.launched = true;
                r.y = ship.y;
                r.x = ship.x;
                step(0.016);
                return { state, lives };
            });
            expect(after.state).toBe('dead');
            expect(after.lives).toBe(2);
        });

        test('lasers destroy rockets and score points', async ({ page }) => {
            const after = await page.evaluate(() => {
                const r = entities.find((e) => e.type === 'rocket');
                placeShipAt(r.x - 200);
                bullets.push({ x: r.x + r.w / 2, y: r.y + r.h / 2, vx: 0 });
                step(0.016);
                return { alive: r.alive, score };
            });
            expect(after.alive).toBe(false);
            expect(after.score).toBe(await page.evaluate(() => SCORE_ROCKET));
        });

        test('UFOs drift through the cave', async ({ page }) => {
            const moved = await page.evaluate(() => {
                const u = entities.find((e) => e.type === 'ufo');
                placeShipAt(u.x - 300);
                const x0 = u.x;
                for (let i = 0; i < 30; i++) step(0.016);
                return u.x !== x0;
            });
            expect(moved).toBe(true);
        });

        test('shooting a UFO scores the most points', async ({ page }) => {
            const scores = await page.evaluate(() => {
                const u = entities.find((e) => e.type === 'ufo');
                placeShipAt(u.x - 300);
                bullets.push({ x: u.x + u.w / 2, y: u.y + u.h / 2, vx: 0 });
                step(0.016);
                return { score, ufo: SCORE_UFO, rocket: SCORE_ROCKET, tank: SCORE_TANK };
            });
            expect(scores.score).toBe(scores.ufo);
            expect(scores.ufo).toBeGreaterThan(scores.rocket);
            expect(scores.ufo).toBeGreaterThan(scores.tank);
        });

        test('destroyed enemies stop being a threat', async ({ page }) => {
            const after = await page.evaluate(() => {
                const t = entities.find((e) => e.type === 'tank');
                t.alive = false;
                placeShipAt(t.x);
                ship.y = t.y;
                step(0.016);
                return state;
            });
            expect(after).toBe('running');
        });
    });

    // -----------------------------------------------------------------------
    // Crashing, lives and game over
    // -----------------------------------------------------------------------
    test.describe('crashing', () => {
        test.beforeEach(async ({ page }) => {
            await page.click('#btn-start');
        });

        test('flying into the ground costs a life', async ({ page }) => {
            const after = await page.evaluate(() => {
                ship.y = CANVAS_H - SHIP_H;
                step(0.016);
                return { state, lives };
            });
            expect(after.state).toBe('dead');
            expect(after.lives).toBe(2);
        });

        test('flying into the ceiling costs a life', async ({ page }) => {
            const after = await page.evaluate(() => {
                const col = terrain.ceiling.findIndex((c) => c > 20);
                placeShipAt(col * COL_W);
                ship.y = 0;
                step(0.016);
                return state;
            });
            expect(after).toBe('dead');
        });

        test('the ship respawns at the checkpoint after a pause', async ({ page }) => {
            const after = await page.evaluate(() => {
                ship.y = CANVAS_H - SHIP_H;
                step(0.016);
                let guard = 0;
                while (state === 'dead' && guard++ < 500) step(0.016);
                return { state, fuel, atCheckpoint: Math.abs(ship.x - checkpointX) < 1 };
            });
            expect(after.state).toBe('running');
            expect(after.fuel).toBe(100);
            expect(after.atCheckpoint).toBe(true);
        });

        test('the checkpoint advances with the zones', async ({ page }) => {
            const cp = await page.evaluate(() => {
                const start = checkpointX;
                placeShipAt(ZONE_COLS * COL_W + 40);
                step(0.016);
                return { start, now: checkpointX };
            });
            expect(cp.now).toBeGreaterThan(cp.start);
        });

        test('a crash clears live shots', async ({ page }) => {
            const left = await page.evaluate(() => {
                fireLaser();
                dropBomb();
                ship.y = CANVAS_H - SHIP_H;
                step(0.016);
                let guard = 0;
                while (state === 'dead' && guard++ < 500) step(0.016);
                return bullets.length + bombs.length;
            });
            expect(left).toBe(0);
        });

        test('losing the last life ends the game', async ({ page }) => {
            await page.evaluate(() => {
                lives = 1;
                ship.y = CANVAS_H - SHIP_H;
                step(0.016);
                let guard = 0;
                while (state === 'dead' && guard++ < 500) step(0.016);
            });
            expect(await page.evaluate(() => state)).toBe('over');
            await expect(page.locator('#overlay')).toHaveClass(/visible/);
            await expect(page.locator('#overlay-title')).toContainText(/over/i);
        });

        test('the final score is shown on the game over overlay', async ({ page }) => {
            await page.evaluate(() => {
                score = 777;
                lives = 1;
                ship.y = CANVAS_H - SHIP_H;
                step(0.016);
                let guard = 0;
                while (state === 'dead' && guard++ < 500) step(0.016);
            });
            await expect(page.locator('#overlay-score')).toContainText('777');
        });

        test('a high score is remembered across reloads', async ({ page }) => {
            await page.evaluate(() => {
                score = 1234;
                lives = 1;
                ship.y = CANVAS_H - SHIP_H;
                step(0.016);
                let guard = 0;
                while (state === 'dead' && guard++ < 500) step(0.016);
            });
            await page.reload();
            await expect(page.locator('#best')).toHaveText('1234');
        });
    });

    // -----------------------------------------------------------------------
    // Pausing
    // -----------------------------------------------------------------------
    test.describe('pausing', () => {
        test.beforeEach(async ({ page }) => {
            await page.click('#btn-start');
        });

        test('P pauses and resumes', async ({ page }) => {
            await page.keyboard.press('p');
            expect(await page.evaluate(() => state)).toBe('paused');
            await page.keyboard.press('p');
            expect(await page.evaluate(() => state)).toBe('running');
        });

        test('the world is frozen while paused', async ({ page }) => {
            await page.keyboard.press('p');
            const moved = await page.evaluate(() => {
                const before = camX;
                for (let i = 0; i < 30; i++) step(0.016);
                return camX !== before;
            });
            expect(moved).toBe(false);
        });

        test('the pause overlay explains how to resume', async ({ page }) => {
            await page.keyboard.press('p');
            await expect(page.locator('#overlay')).toHaveClass(/visible/);
            await expect(page.locator('#overlay-title')).toContainText(/paused/i);
        });

        test('P does nothing before the game starts', async ({ page }) => {
            await page.reload();
            await page.keyboard.press('p');
            expect(await page.evaluate(() => state)).toBe('idle');
        });
    });

    // -----------------------------------------------------------------------
    // Finishing the run
    // -----------------------------------------------------------------------
    test.describe('finishing', () => {
        test.beforeEach(async ({ page }) => {
            await page.click('#btn-start');
        });

        test('reaching the base wins the mission', async ({ page }) => {
            await page.evaluate(() => {
                placeShipAt(FINISH_X - 5);
                for (let i = 0; i < 5; i++) step(0.016);
            });
            expect(await page.evaluate(() => state)).toBe('won');
            await expect(page.locator('#overlay-title')).toContainText(/complete|win/i);
        });

        test('leftover fuel is worth bonus points', async ({ page }) => {
            const finalScore = await page.evaluate(() => {
                score = 0;
                fuel = 80;
                placeShipAt(FINISH_X - 5);
                for (let i = 0; i < 5; i++) step(0.016);
                return score;
            });
            expect(finalScore).toBeGreaterThan(await page.evaluate(() => SCORE_FINISH));
        });

        test('the world stops once the mission is complete', async ({ page }) => {
            const moved = await page.evaluate(() => {
                placeShipAt(FINISH_X - 5);
                for (let i = 0; i < 5; i++) step(0.016);
                const before = camX;
                for (let i = 0; i < 30; i++) step(0.016);
                return camX !== before;
            });
            expect(moved).toBe(false);
        });

        test('the zone name is shown while flying', async ({ page }) => {
            await expect(page.locator('#zone')).toHaveText(await page.evaluate(() => ZONES[0]));
            await page.evaluate(() => {
                placeShipAt(ZONE_COLS * COL_W + 40);
                step(0.016);
            });
            await expect(page.locator('#zone')).toHaveText(await page.evaluate(() => ZONES[1]));
        });
    });

    // -----------------------------------------------------------------------
    // Rendering
    // -----------------------------------------------------------------------
    test.describe('rendering', () => {
        test('the canvas draws something once the game starts', async ({ page }) => {
            await page.click('#btn-start');
            await page.evaluate((body) => { eval(body); draw(); }, flySafely(30));
            const painted = await page.evaluate(() => {
                const data = canvas.getContext('2d')
                    .getImageData(0, 0, CANVAS_W, CANVAS_H).data;
                const seen = new Set();
                for (let i = 0; i < data.length; i += 4) {
                    seen.add(`${data[i]},${data[i + 1]},${data[i + 2]}`);
                }
                return seen.size;
            });
            expect(painted).toBeGreaterThan(3);
        });

        test('the game loop runs without console errors', async ({ page }) => {
            const errors = [];
            page.on('pageerror', (e) => errors.push(e.message));
            await page.click('#btn-start');
            await page.waitForTimeout(600);
            expect(errors).toEqual([]);
        });
    });
});
